export interface ContractorMembership {
  contractorId: string;
  role: string;
  contractor: { id: string; name: string; domain: string };
}

export interface ActiveContractor {
  id: string;
  name: string;
  domain: string;
  role: string;
}
