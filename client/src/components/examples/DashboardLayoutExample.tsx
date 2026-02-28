import { DashboardLayout } from '../DashboardLayout';
import { DashboardMetrics } from '../DashboardMetrics';
import { CustomerCard } from '../CustomerCard';
import { JobCard } from '../JobCard';

export default function DashboardLayoutExample() {
  // TODO: remove mock functionality
  const mockUser = {
    id: "1",
    name: "John Smith", 
    email: "john.smith@elmarhvac.com",
    role: "admin",
  };

  const mockTenants = [
    {
      id: "1",
      name: "Elmar HVAC",
      domain: "elmar.crm.com",
      role: "admin",
    },
    {
      id: "2",
      name: "Johnson Plumbing", 
      domain: "johnson.crm.com",
      role: "manager",
    },
  ];

  const mockMetrics = {
    totalLeads: 47,
    pendingEstimates: 18,
    activeJobs: 32,
    monthlyRevenue: 45600,
    leadsGrowth: 12.5,
    estimatesGrowth: 8.3,
    jobsGrowth: 15.2,
    revenueGrowth: -2.1,
  };

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
  ];

  const mockJobs = [
    {
      id: "job-1",
      title: "HVAC System Installation",
      customer: { name: "Sarah Johnson" },
      status: "in_progress" as const,
      value: 3500,
      scheduledDate: "Dec 15, 2024",
      type: "Installation",
      priority: "high" as const,
      estimatedHours: 6,
    },
    {
      id: "job-2", 
      title: "Annual Maintenance Check",
      customer: { name: "Mike Davis" },
      status: "completed" as const,
      value: 200,
      scheduledDate: "Dec 10, 2024",
      type: "Maintenance",
      priority: "low" as const,
      estimatedHours: 2,
    },
  ];

  const handleTenantChange = (tenant: any) => {
    console.log("Tenant changed:", tenant);
  };

  const handleSearch = (query: string) => {
    console.log("Search:", query);
  };

  const handleQuickAction = (action: string) => {
    console.log("Quick action:", action);
  };

  return (
    <DashboardLayout
      user={mockUser}
      tenants={mockTenants}
      currentTenant={mockTenants[0]}
      onTenantChange={handleTenantChange}
      onSearch={handleSearch}
      onQuickAction={handleQuickAction}
    >
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
          <DashboardMetrics metrics={mockMetrics} />
        </div>
        
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-lg font-medium mb-4">Recent Customers</h2>
            <div className="space-y-4">
              {mockCustomers.map((customer) => (
                <CustomerCard key={customer.id} customer={customer} />
              ))}
            </div>
          </div>
          
          <div>
            <h2 className="text-lg font-medium mb-4">Active Jobs</h2>
            <div className="space-y-4">
              {mockJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}