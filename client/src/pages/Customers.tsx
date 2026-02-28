import { useState } from "react";
import { CustomerCard } from "@/components/CustomerCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Search, Filter, Users } from "lucide-react";

export default function Customers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive" | "lead">("all");

  // TODO: remove mock functionality
  const mockCustomers = [
    {
      id: "1",
      name: "Sarah Johnson",
      email: "sarah.johnson@email.com",
      phone: "(555) 123-4567",
      address: "123 Main St, Anytown, ST 12345",
      jobsCount: 8,
      lastActivity: "2 hours ago",
      status: "active" as const,
    },
    {
      id: "2",
      name: "Mike Davis",
      email: "mike.davis@email.com",
      phone: "(555) 987-6543",
      address: "456 Oak Ave, Somewhere, ST 67890",
      jobsCount: 3,
      lastActivity: "1 day ago",
      status: "lead" as const,
    },
    {
      id: "3",
      name: "Emily Wilson",
      email: "emily.wilson@email.com",
      phone: "(555) 555-0123",
      address: "789 Pine St, Anyplace, ST 54321",
      jobsCount: 12,
      lastActivity: "3 days ago",
      status: "active" as const,
    },
    {
      id: "4",
      name: "Robert Brown",
      email: "robert.brown@email.com",
      phone: "(555) 246-8101",
      address: "321 Elm St, Nowhere, ST 98765",
      jobsCount: 0,
      lastActivity: "1 week ago",
      status: "inactive" as const,
    },
    {
      id: "5",
      name: "Lisa Martinez",
      email: "lisa.martinez@email.com",
      phone: "(555) 369-2580",
      address: "654 Maple Dr, Somewhere Else, ST 13579",
      jobsCount: 5,
      lastActivity: "1 hour ago",
      status: "active" as const,
    },
    {
      id: "6",
      name: "David Taylor",
      email: "david.taylor@email.com",
      phone: "(555) 147-2583",
      address: "987 Cedar Ln, Anyplace Else, ST 24680",
      jobsCount: 1,
      lastActivity: "2 days ago",
      status: "lead" as const,
    },
  ];

  const filteredCustomers = mockCustomers.filter((customer) => {
    const matchesSearch = customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         customer.phone.includes(searchQuery);
    const matchesFilter = filterStatus === "all" || customer.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const statusCounts = {
    all: mockCustomers.length,
    active: mockCustomers.filter(c => c.status === "active").length,
    lead: mockCustomers.filter(c => c.status === "lead").length,
    inactive: mockCustomers.filter(c => c.status === "inactive").length,
  };

  const handleAddCustomer = () => {
    console.log("Add customer clicked");
  };

  const handleContact = (customerId: string, method: "phone" | "email") => {
    console.log(`Contacting customer ${customerId} via ${method}`);
  };

  const handleViewJobs = (customerId: string) => {
    console.log(`Viewing jobs for customer ${customerId}`);
  };

  return (
    <PageLayout>
      <PageHeader 
        title="Customers" 
        description="Manage your customer relationships and contact information"
        icon={<Users className="h-6 w-6" />}
        actions={
          <Button onClick={handleAddCustomer} data-testid="button-add-customer">
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
            data-testid="input-customer-search"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex gap-2">
            {(["all", "active", "lead", "inactive"] as const).map((status) => (
              <Badge
                key={status}
                variant={filterStatus === status ? "default" : "outline"}
                className="cursor-pointer hover-elevate"
                onClick={() => setFilterStatus(status)}
                data-testid={`filter-${status}`}
              >
                {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredCustomers.map((customer) => (
          <CustomerCard
            key={customer.id}
            customer={customer}
            onContact={handleContact}
            onViewJobs={handleViewJobs}
          />
        ))}
      </div>

      {filteredCustomers.length === 0 && (
        <div className="text-center py-12">
          <div className="text-muted-foreground">
            {searchQuery || filterStatus !== "all" 
              ? "No customers found matching your criteria." 
              : "No customers yet."
            }
          </div>
          {searchQuery === "" && filterStatus === "all" && (
            <Button className="mt-4" onClick={handleAddCustomer}>
              <Plus className="h-4 w-4 mr-2" />
              Add your first customer
            </Button>
          )}
        </div>
      )}
    </PageLayout>
  );
}