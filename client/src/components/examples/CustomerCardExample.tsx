import { CustomerCard } from '../CustomerCard';

export default function CustomerCardExample() {
  // TODO: remove mock functionality
  const mockCustomer = {
    id: "1",
    name: "Sarah Johnson",
    email: "sarah.johnson@email.com",
    phone: "(555) 123-4567",
    address: "123 Main St, Anytown, ST 12345",
    jobsCount: 8,
    lastActivity: "2 hours ago",
    status: "active" as const,
  };

  const handleContact = (customerId: string, method: "phone" | "email") => {
    console.log(`Contacting customer ${customerId} via ${method}`);
  };

  const handleViewJobs = (customerId: string) => {
    console.log(`Viewing jobs for customer ${customerId}`);
  };

  return (
    <div className="p-6 max-w-sm">
      <CustomerCard
        customer={mockCustomer}
        onContact={handleContact}
        onViewJobs={handleViewJobs}
      />
    </div>
  );
}