import { TenantSwitcher } from '../TenantSwitcher';
import { useState } from 'react';

export default function TenantSwitcherExample() {
  // TODO: remove mock functionality
  const mockTenants = [
    {
      id: "1",
      name: "Elmar HVAC",
      domain: "elmar.crm.com",
      role: "admin" as const,
    },
    {
      id: "2", 
      name: "Johnson Plumbing",
      domain: "johnson.crm.com",
      role: "manager" as const,
    },
    {
      id: "3",
      name: "Smith Electric",
      domain: "smith.crm.com", 
      role: "user" as const,
    },
  ];

  const [currentTenant, setCurrentTenant] = useState(mockTenants[0]);

  const handleTenantChange = (tenant: any) => {
    setCurrentTenant(tenant);
  };

  return (
    <div className="p-6">
      <TenantSwitcher
        tenants={mockTenants}
        currentTenant={currentTenant}
        onTenantChange={handleTenantChange}
      />
    </div>
  );
}