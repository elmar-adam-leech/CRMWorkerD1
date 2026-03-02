import { useState, useRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";

export interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (formatted: string, components: AddressComponents) => void;
  endpoint: string;
  credentials?: RequestCredentials;
  placeholder?: string;
  "data-testid"?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onAddressSelect,
  endpoint,
  credentials = "include",
  placeholder,
  "data-testid": testId,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; text: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = async (input: string) => {
    if (!input || input.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    try {
      const resp = await fetch(
        `${endpoint}/autocomplete?input=${encodeURIComponent(input)}`,
        { credentials }
      );
      if (!resp.ok) return;
      const data = await resp.json();
      const mapped = (data.suggestions || [])
        .map((s: any) => ({
          placeId: s.placePrediction?.placeId || "",
          text: s.placePrediction?.text?.text || "",
        }))
        .filter((s: any) => s.placeId && s.text);
      setSuggestions(mapped);
      setShowDropdown(mapped.length > 0);
    } catch (e) {
      console.warn("[Places] Failed to fetch suggestions:", e);
    }
  };

  const handleInputChange = (val: string) => {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const handleSelect = async (suggestion: { placeId: string; text: string }) => {
    setShowDropdown(false);
    setSuggestions([]);
    onChange(suggestion.text);
    try {
      const resp = await fetch(
        `${endpoint}/details?placeId=${encodeURIComponent(suggestion.placeId)}`,
        { credentials }
      );
      if (!resp.ok) {
        onAddressSelect(suggestion.text, {
          street: suggestion.text,
          city: "",
          state: "",
          zip: "",
          country: "US",
        });
        return;
      }
      const place = await resp.json();
      let streetNumber = "";
      let route = "";
      let city = "";
      let state = "";
      let zip = "";
      for (const component of place.addressComponents || []) {
        const types: string[] = component.types || [];
        if (types.includes("street_number")) streetNumber = component.longText || "";
        else if (types.includes("route")) route = component.longText || "";
        else if (types.includes("locality")) city = component.longText || "";
        else if (types.includes("administrative_area_level_1")) state = component.shortText || "";
        else if (types.includes("postal_code")) zip = component.longText || "";
      }
      const street = [streetNumber, route].filter(Boolean).join(" ");
      const formatted = place.formattedAddress || suggestion.text;
      onChange(formatted);
      onAddressSelect(formatted, { street, city, state, zip, country: "US" });
    } catch (e) {
      console.warn("[Places] Failed to fetch place details:", e);
      onAddressSelect(suggestion.text, {
        street: suggestion.text,
        city: "",
        state: "",
        zip: "",
        country: "US",
      });
    }
  };

  return (
    <PopoverPrimitive.Root open={showDropdown} onOpenChange={setShowDropdown}>
      <PopoverPrimitive.Anchor asChild>
        <Input
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
          }}
          placeholder={placeholder}
          data-testid={testId}
          autoComplete="off"
        />
      </PopoverPrimitive.Anchor>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-anchor-width)]"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={() => setShowDropdown(false)}
      >
        {suggestions.map((s, i) => (
          <button
            key={i}
            type="button"
            className="w-full text-left px-3 py-2 text-sm hover-elevate cursor-pointer"
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(s);
            }}
          >
            {s.text}
          </button>
        ))}
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
