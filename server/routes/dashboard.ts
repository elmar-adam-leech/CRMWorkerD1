import type { Express, Response } from "express";
import { storage } from "../storage";
import type { AuthenticatedRequest } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";

// Minimal types for the Google Places API v1 responses used in this file.
// Only fields actually consumed by the handlers are listed. See:
//   https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
interface GooglePlacesAutocompleteResponse {
  suggestions?: unknown[];
  error?: { message: string; status: string };
}
interface GooglePlacesDetailsResponse {
  formattedAddress?: string;
  addressComponents?: unknown[];
  error?: { message: string; status: string };
}

export function registerDashboardRoutes(app: Express): void {
  // Google Places API proxy — authenticated, server-side calls bypass browser referrer restrictions
  app.get('/api/places/autocomplete', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 3) {
      res.json({ suggestions: [] });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key not configured' });
      return;
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'Referer': appUrl,
      },
      body: JSON.stringify({
        input: input.trim(),
        includedRegionCodes: ['us'],
      }),
    });
    const data = await response.json() as GooglePlacesAutocompleteResponse;
    if (!response.ok) {
      console.error('[Places Autocomplete] API error:', data);
      res.status(502).json({ error: 'Places API error', details: data });
      return;
    }
    res.json({ suggestions: data.suggestions || [] });
  }));

  app.get('/api/places/details', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { placeId } = req.query as { placeId?: string };
    if (!placeId) {
      res.status(400).json({ error: 'placeId is required' });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key not configured' });
      return;
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=formattedAddress,addressComponents`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'Referer': appUrl,
        },
      }
    );
    const data = await response.json() as GooglePlacesDetailsResponse;
    if (!response.ok) {
      console.error('[Places Details] API error:', data);
      res.status(502).json({ error: 'Places API error', details: data });
      return;
    }
    res.json(data);
  }));

  // Dashboard metrics route
  app.get("/api/dashboard/metrics", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { timeframe, startDate, endDate } = req.query;

    let start: Date | undefined;
    let end: Date | undefined;

    const now = new Date();
    now.setHours(23, 59, 59, 999);

    if (timeframe === 'this_week') {
      start = new Date(now);
      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      end = now;
    } else if (timeframe === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      end = now;
    } else if (timeframe === 'this_year') {
      start = new Date(now.getFullYear(), 0, 1);
      start.setHours(0, 0, 0, 0);
      end = now;
    } else if (timeframe === 'custom' && startDate && endDate) {
      start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0);
      end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
    }

    const metrics = await storage.getDashboardMetrics(
      req.user!.contractorId,
      req.user!.userId,
      req.user!.role,
      start,
      end
    );
    res.json(metrics);
  }));
}
