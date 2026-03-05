import { 
  type User, type InsertUser,
  type UserContractor, type InsertUserContractor,
  type Contractor, type InsertContractor,
  type Contact, type InsertContact,
  type PaginatedContacts,
  type Lead, type InsertLead,
  type Job, type InsertJob,
  type PaginatedJobs,
  type Estimate, type InsertEstimate,
  type PaginatedEstimates,
  type Message, type InsertMessage,
  type Template, type InsertTemplate,
  type Call, type InsertCall,
  type ContractorCredential, type InsertContractorCredential,
  type ContractorProvider,
  type ContractorIntegration,
  type Employee, type InsertEmployee,
  type Activity, type InsertActivity,
  type BusinessTargets, type InsertBusinessTargets,
  type DialpadPhoneNumber, type InsertDialpadPhoneNumber,
  type UserPhoneNumberPermission, type InsertUserPhoneNumberPermission,
  type DialpadUser, type InsertDialpadUser,
  type DialpadDepartment, type InsertDialpadDepartment,
  type DialpadSyncJob, type InsertDialpadSyncJob,
  type SyncSchedule, type InsertSyncSchedule,
  type TerminologySettings, type InsertTerminologySettings,
  type Notification, type InsertNotification,
  type Workflow, type InsertWorkflow,
  type WorkflowStep, type InsertWorkflowStep,
  type WorkflowExecution, type InsertWorkflowExecution,
} from "@shared/schema";

export * from "./storage-types";
import type {
  UpdateUser,
  UpdateContractor,
  UpdateContact,
  UpdateJob,
  UpdateEstimate,
  UpdateTemplate,
  UpdateCall,
  UpdateActivity,
  UpdateBusinessTargets,
  UpdateDialpadPhoneNumber,
  UpdateUserPhoneNumberPermission,
  UpdateDialpadUser,
  UpdateDialpadDepartment,
  UpdateDialpadSyncJob,
  UpdateSyncSchedule,
  UpdateTerminologySettings,
  UpdateWorkflow,
  UpdateWorkflowStep,
  UpdateWorkflowExecution,
} from "./storage-types";

import { userMethods } from "./storage/users";
import { contactMethods } from "./storage/contacts";
import { jobEstimateMethods } from "./storage/jobs-estimates";
import { messagingMethods } from "./storage/messaging";
import { integrationMethods } from "./storage/integrations";
import { dialpadMethods } from "./storage/dialpad";
import { workflowMethods } from "./storage/workflows";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByEmailAndContractor(email: string, contractorId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  verifyPassword(username: string, password: string): Promise<User | null>;
  verifyPasswordByEmail(email: string, password: string): Promise<User | null>;
  updateUser(id: string, user: UpdateUser): Promise<User | undefined>;
  switchContractor(userId: string, contractorId: string): Promise<User | undefined>;
  
  // User-Contractor relationship operations
  getUserContractors(userId: string): Promise<UserContractor[]>;
  getContractorUsers(contractorId: string): Promise<UserContractor[]>;
  getUserContractor(userId: string, contractorId: string): Promise<UserContractor | undefined>;
  addUserToContractor(userContractor: InsertUserContractor): Promise<UserContractor>;
  removeUserFromContractor(userId: string, contractorId: string): Promise<boolean>;
  updateUserContractor(userId: string, contractorId: string, updates: Partial<InsertUserContractor>): Promise<UserContractor | undefined>;
  ensureUserContractorEntry(userId: string, contractorId: string, role: 'super_admin' | 'admin' | 'manager' | 'user', canManageIntegrations?: boolean): Promise<UserContractor>;

  // Contractor operations
  getContractor(id: string): Promise<Contractor | undefined>;
  getContractorByDomain(domain: string): Promise<Contractor | undefined>;
  getContractorBySlug(slug: string): Promise<Contractor | undefined>;
  createContractor(contractor: InsertContractor): Promise<Contractor>;
  updateContractor(id: string, contractor: UpdateContractor): Promise<Contractor | undefined>;

  // Contact operations (unified leads and customers)
  getContacts(contractorId: string, type?: 'lead' | 'customer' | 'inactive'): Promise<Contact[]>;
  getContactsPaginated(contractorId: string, options?: {
    cursor?: string;
    limit?: number;
    type?: 'lead' | 'customer' | 'inactive';
    status?: string;
    search?: string;
  }): Promise<PaginatedContacts>;
  getContactsCount(contractorId: string, options?: {
    type?: 'lead' | 'customer' | 'inactive';
    status?: string;
    search?: string;
  }): Promise<number>;
  getContactsStatusCounts(contractorId: string, options?: {
    search?: string;
    type?: 'lead' | 'customer' | 'inactive';
  }): Promise<{
    all: number;
    new: number;
    contacted: number;
    scheduled: number;
    disqualified: number;
  }>;
  getContact(id: string, contractorId: string): Promise<Contact | undefined>;
  getContactByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Contact | undefined>;
  getContactByPhone(phone: string, contractorId: string): Promise<Contact | undefined>;
  getContactByHousecallProCustomerId(housecallProCustomerId: string, contractorId: string): Promise<Contact | undefined>;
  createContact(contact: Omit<InsertContact, 'contractorId'>, contractorId: string): Promise<Contact>;
  updateContact(id: string, contact: UpdateContact, contractorId: string): Promise<Contact | undefined>;
  markContactContacted(contactId: string, contractorId: string, userId: string, contactedAt?: Date): Promise<Contact | undefined>;
  deleteContact(id: string, contractorId: string): Promise<boolean>;
  unlinkOrphanedEmailActivities(contactId: string, currentEmails: string[], contractorId: string): Promise<void>;
  findMatchingContact(contractorId: string, emails?: string[], phones?: string[]): Promise<string | null>;

  // Lead operations (individual lead submissions)
  getLeads(contractorId: string): Promise<Lead[]>;
  getLeadsByContact(contactId: string, contractorId: string): Promise<Lead[]>;
  getLead(id: string, contractorId: string): Promise<Lead | undefined>;
  createLead(lead: Omit<InsertLead, 'contractorId'>, contractorId: string): Promise<Lead>;
  updateLead(id: string, lead: Partial<InsertLead>, contractorId: string): Promise<Lead | undefined>;
  deleteLead(id: string, contractorId: string): Promise<boolean>;

  // Job operations
  getJobs(contractorId: string): Promise<Job[]>;
  getJobsPaginated(contractorId: string, options?: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<PaginatedJobs>;
  getJobsCount(contractorId: string, options?: {
    status?: string;
    search?: string;
  }): Promise<number>;
  getJobsStatusCounts(contractorId: string, options?: {
    search?: string;
  }): Promise<{
    all: number;
    scheduled: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  }>;
  getJob(id: string, contractorId: string): Promise<Job | undefined>;
  getJobByEstimateId(estimateId: string, contractorId: string): Promise<Job | undefined>;
  getJobByHousecallProJobId(externalId: string, contractorId: string): Promise<Job | undefined>;
  createJob(job: Omit<InsertJob, 'contractorId'>, contractorId: string): Promise<Job>;
  updateJob(id: string, job: UpdateJob, contractorId: string): Promise<Job | undefined>;
  deleteJob(id: string, contractorId: string): Promise<boolean>;

  // Estimate operations
  getEstimates(contractorId: string): Promise<Estimate[]>;
  getEstimatesPaginated(contractorId: string, options?: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<PaginatedEstimates>;
  getEstimatesCount(contractorId: string, options?: {
    status?: string;
    search?: string;
  }): Promise<number>;
  getEstimatesStatusCounts(contractorId: string, options?: {
    search?: string;
  }): Promise<{
    all: number;
    sent: number;
    pending: number;
    approved: number;
    rejected: number;
  }>;
  getEstimate(id: string, contractorId: string): Promise<Estimate | undefined>;
  createEstimate(estimate: Omit<InsertEstimate, 'contractorId'>, contractorId: string): Promise<Estimate>;
  updateEstimate(id: string, estimate: UpdateEstimate, contractorId: string): Promise<Estimate | undefined>;
  deleteEstimate(id: string, contractorId: string): Promise<boolean>;

  // Dashboard metrics
  getDashboardMetrics(contractorId: string, userId: string, userRole: string, startDate?: Date, endDate?: Date): Promise<{
    speedToLeadMinutes: number;
    setRate: number;
    totalLeads: number;
    todaysFollowUps: number;
  }>;

  getMetricsAggregates(contractorId: string, periodStart: Date): Promise<{
    totalLeads: number;
    contactedLeads: number;
    avgSpeedToLeadHours: number;
    scheduledLeads: number;
    totalEstimates: number;
    completedJobs: number;
    revenue: number;
  }>;

  getContactsWithFollowUp(contractorId: string, limit?: number): Promise<Contact[]>;
  getEstimatesWithFollowUp(contractorId: string, limit?: number): Promise<Estimate[]>;

  // Contact deduplication
  deduplicateContacts(contractorId: string): Promise<{
    duplicatesFound: number;
    contactsMerged: number;
    contactsDeleted: number;
  }>;

  // Message operations
  getMessages(contractorId: string, contactId?: string, estimateId?: string): Promise<Message[]>;
  getMessage(id: string, contractorId: string): Promise<Message | undefined>;
  createMessage(message: Omit<InsertMessage, 'contractorId'>, contractorId: string): Promise<Message>;
  
  // Enhanced message operations for unified communications
  getAllMessages(contractorId: string, options?: {
    type?: 'text' | 'email';
    status?: 'sent' | 'delivered' | 'failed';
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Message[]>;
  getConversations(contractorId: string, options?: {
    search?: string;
    type?: 'text' | 'email';
    status?: 'sent' | 'delivered' | 'failed';
  }): Promise<Array<{
    contactId: string;
    contactName: string;
    contactPhone?: string;
    contactEmail?: string;
    lastMessage: Message;
    unreadCount: number;
    totalMessages: number;
  }>>;
  getConversationMessages(contractorId: string, contactId: string): Promise<Message[]>;
  getConversationMessageCount(contractorId: string, contactId: string): Promise<number>;

  // Template operations
  getTemplates(contractorId: string, type?: 'text' | 'email'): Promise<Template[]>;
  getTemplate(id: string, contractorId: string): Promise<Template | undefined>;
  createTemplate(template: Omit<InsertTemplate, 'contractorId'>, contractorId: string): Promise<Template>;
  updateTemplate(id: string, template: UpdateTemplate, contractorId: string): Promise<Template | undefined>;
  deleteTemplate(id: string, contractorId: string): Promise<boolean>;

  // Call operations
  getCalls(contractorId: string): Promise<Call[]>;
  getCall(id: string, contractorId: string): Promise<Call | undefined>;
  getCallByExternalId(externalCallId: string, contractorId: string): Promise<Call | undefined>;
  createCall(call: Omit<InsertCall, 'contractorId'>, contractorId: string): Promise<Call>;
  updateCall(id: string, call: UpdateCall, contractorId: string): Promise<Call | undefined>;

  // Contractor credential operations
  getContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<ContractorCredential | undefined>;
  getContractorServiceCredentials(contractorId: string, service: string): Promise<ContractorCredential[]>;
  setContractorCredential(contractorId: string, service: string, credentialKey: string, encryptedValue: string): Promise<ContractorCredential>;
  disableContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<void>;

  // Tenant provider operations (active provider selection per type)
  getTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<ContractorProvider | undefined>;
  setTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<ContractorProvider>;
  getTenantProviders(contractorId: string): Promise<ContractorProvider[]>;
  disableTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<void>;

  // Alias methods for backwards compatibility
  getContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<ContractorProvider | undefined>;
  setContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<ContractorProvider>;
  getContractorProviders(contractorId: string): Promise<ContractorProvider[]>;
  disableContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<void>;

  // Tenant integration enablement operations
  getTenantIntegration(contractorId: string, integrationName: string): Promise<ContractorIntegration | undefined>;
  getTenantIntegrations(contractorId: string): Promise<ContractorIntegration[]>;
  getEnabledIntegrations(contractorId: string): Promise<ContractorIntegration[]>;
  enableTenantIntegration(contractorId: string, integrationName: string, enabledBy?: string): Promise<ContractorIntegration>;
  disableTenantIntegration(contractorId: string, integrationName: string): Promise<void>;
  isIntegrationEnabled(contractorId: string, integrationName: string): Promise<boolean>;

  // Alias methods for backwards compatibility
  getContractorIntegration(contractorId: string, integrationName: string): Promise<ContractorIntegration | undefined>;
  getContractorIntegrations(contractorId: string): Promise<ContractorIntegration[]>;
  enableContractorIntegration(contractorId: string, integrationName: string, enabledBy?: string): Promise<ContractorIntegration>;
  disableContractorIntegration(contractorId: string, integrationName: string): Promise<void>;

  // Housecall Pro integration operations
  getContactByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Contact | undefined>;
  getEstimateByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Estimate | undefined>;
  getEstimatesByHousecallProIds(housecallProEstimateIds: string[], contractorId: string): Promise<Map<string, Estimate>>;
  getScheduledContacts(contractorId: string): Promise<Contact[]>;
  getUnscheduledContacts(contractorId: string): Promise<Contact[]>;
  scheduleContactAsEstimate(contactId: string, housecallProData: {
    housecallProCustomerId: string;
    housecallProEstimateId: string;
    scheduledAt: Date;
    scheduledEmployeeId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    description?: string;
  }, contractorId: string): Promise<{ contact: Contact; estimate: Estimate } | undefined>;

  // Activity operations
  getActivities(contractorId: string, options?: {
    contactId?: string;
    estimateId?: string;
    jobId?: string;
    type?: 'note' | 'call' | 'email' | 'sms' | 'meeting' | 'follow_up' | 'status_change';
    limit?: number;
    offset?: number;
  }): Promise<Activity[]>;
  getActivity(id: string, contractorId: string): Promise<Activity | undefined>;
  createActivity(activity: Omit<InsertActivity, 'contractorId'>, contractorId: string): Promise<Activity>;
  updateActivity(id: string, activity: UpdateActivity, contractorId: string): Promise<Activity | undefined>;
  deleteActivity(id: string, contractorId: string): Promise<boolean>;

  // Employee operations
  getEmployees(contractorId: string): Promise<Employee[]>;
  getEmployee(id: string, contractorId: string): Promise<Employee | undefined>;
  getEmployeeByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Employee | undefined>;
  upsertEmployees(employees: Omit<InsertEmployee, 'contractorId'>[], contractorId: string): Promise<Employee[]>;
  updateEmployeeRoles(id: string, roles: string[], contractorId: string): Promise<Employee | undefined>;

  // Business targets operations
  getBusinessTargets(contractorId: string): Promise<BusinessTargets | undefined>;
  createBusinessTargets(targets: Omit<InsertBusinessTargets, 'contractorId'>, contractorId: string): Promise<BusinessTargets>;
  updateBusinessTargets(targets: UpdateBusinessTargets, contractorId: string): Promise<BusinessTargets | undefined>;

  // Housecall Pro sync start date operations
  getHousecallProSyncStartDate(contractorId: string): Promise<Date | null>;
  setHousecallProSyncStartDate(contractorId: string, syncStartDate: Date | null): Promise<void>;

  // Dialpad phone number operations
  getDialpadPhoneNumbers(contractorId: string): Promise<DialpadPhoneNumber[]>;
  getDialpadPhoneNumber(id: string, contractorId: string): Promise<DialpadPhoneNumber | undefined>;
  getDialpadPhoneNumberByNumber(contractorId: string, phoneNumber: string): Promise<DialpadPhoneNumber | undefined>;
  getDialpadPhoneNumbersByIds(ids: string[]): Promise<DialpadPhoneNumber[]>;
  createDialpadPhoneNumber(phoneNumber: InsertDialpadPhoneNumber): Promise<DialpadPhoneNumber>;
  updateDialpadPhoneNumber(id: string, phoneNumber: UpdateDialpadPhoneNumber): Promise<DialpadPhoneNumber>;

  // User phone number permission operations
  getUserPhoneNumberPermissions(userId: string): Promise<UserPhoneNumberPermission[]>;
  getUserPhoneNumberPermission(userId: string, phoneNumberId: string): Promise<UserPhoneNumberPermission | undefined>;
  createUserPhoneNumberPermission(permission: InsertUserPhoneNumberPermission): Promise<UserPhoneNumberPermission>;
  updateUserPhoneNumberPermission(id: string, permission: UpdateUserPhoneNumberPermission): Promise<UserPhoneNumberPermission>;
  deleteUserPhoneNumberPermission(id: string): Promise<boolean>;

  // Dialpad caching operations
  getDialpadUsers(contractorId: string): Promise<DialpadUser[]>;
  getDialpadUser(id: string, contractorId: string): Promise<DialpadUser | undefined>;
  getDialpadUserByDialpadId(dialpadUserId: string, contractorId: string): Promise<DialpadUser | undefined>;
  createDialpadUser(user: InsertDialpadUser): Promise<DialpadUser>;
  updateDialpadUser(id: string, user: UpdateDialpadUser): Promise<DialpadUser>;
  deleteDialpadUser(id: string): Promise<boolean>;

  getDialpadDepartments(contractorId: string): Promise<DialpadDepartment[]>;
  getDialpadDepartment(id: string, contractorId: string): Promise<DialpadDepartment | undefined>;
  getDialpadDepartmentByDialpadId(dialpadDepartmentId: string, contractorId: string): Promise<DialpadDepartment | undefined>;
  createDialpadDepartment(department: InsertDialpadDepartment): Promise<DialpadDepartment>;
  updateDialpadDepartment(id: string, department: UpdateDialpadDepartment): Promise<DialpadDepartment>;
  deleteDialpadDepartment(id: string): Promise<boolean>;

  getDialpadSyncJobs(contractorId: string, limit?: number): Promise<DialpadSyncJob[]>;
  getDialpadSyncJob(id: string, contractorId: string): Promise<DialpadSyncJob | undefined>;
  getLatestDialpadSyncJob(contractorId: string, syncType?: string): Promise<DialpadSyncJob | undefined>;
  createDialpadSyncJob(syncJob: InsertDialpadSyncJob): Promise<DialpadSyncJob>;
  updateDialpadSyncJob(id: string, syncJob: UpdateDialpadSyncJob): Promise<DialpadSyncJob>;

  // Sync schedule operations
  getSyncSchedules(contractorId: string): Promise<SyncSchedule[]>;
  getSyncSchedule(contractorId: string, integrationName: string): Promise<SyncSchedule | undefined>;
  getDueSyncSchedules(): Promise<SyncSchedule[]>;
  createSyncSchedule(schedule: InsertSyncSchedule): Promise<SyncSchedule>;
  updateSyncSchedule(contractorId: string, integrationName: string, schedule: UpdateSyncSchedule): Promise<SyncSchedule | undefined>;
  deleteSyncSchedule(contractorId: string, integrationName: string): Promise<boolean>;

  // Terminology settings operations
  getTerminologySettings(contractorId: string): Promise<TerminologySettings | undefined>;
  createTerminologySettings(settings: Omit<InsertTerminologySettings, 'contractorId'>, contractorId: string): Promise<TerminologySettings>;
  updateTerminologySettings(settings: UpdateTerminologySettings, contractorId: string): Promise<TerminologySettings | undefined>;

  // Notification operations
  getNotifications(userId: string, contractorId: string, limit?: number): Promise<Notification[]>;
  getUnreadNotifications(userId: string, contractorId: string): Promise<Notification[]>;
  getNotification(id: string, userId: string): Promise<Notification | undefined>;
  createNotification(notification: Omit<InsertNotification, 'contractorId'>, contractorId: string): Promise<Notification>;
  markNotificationAsRead(id: string, userId: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string, contractorId: string): Promise<void>;
  deleteNotification(id: string, userId: string): Promise<boolean>;

  // Workflow operations
  getWorkflows(contractorId: string, approvalStatus?: string): Promise<Workflow[]>;
  getActiveWorkflows(contractorId: string): Promise<Workflow[]>;
  getWorkflowsPendingApproval(contractorId: string): Promise<Workflow[]>;
  getWorkflow(id: string, contractorId: string): Promise<Workflow | undefined>;
  createWorkflow(workflow: Omit<InsertWorkflow, 'contractorId'>, contractorId: string, userId: string): Promise<Workflow>;
  updateWorkflow(id: string, workflow: UpdateWorkflow, contractorId: string): Promise<Workflow | undefined>;
  deleteWorkflow(id: string, contractorId: string): Promise<boolean>;
  approveWorkflow(id: string, contractorId: string, approvedByUserId: string): Promise<Workflow | undefined>;
  rejectWorkflow(id: string, contractorId: string, rejectedByUserId: string, rejectionReason?: string): Promise<Workflow | undefined>;
  
  // Workflow step operations
  getWorkflowSteps(workflowId: string): Promise<WorkflowStep[]>;
  getWorkflowStep(id: string): Promise<WorkflowStep | undefined>;
  createWorkflowStep(step: InsertWorkflowStep): Promise<WorkflowStep>;
  updateWorkflowStep(id: string, step: UpdateWorkflowStep): Promise<WorkflowStep | undefined>;
  deleteWorkflowStep(id: string): Promise<boolean>;
  deleteWorkflowSteps(workflowId: string): Promise<boolean>;
  
  // Workflow execution operations
  getWorkflowExecutions(workflowId: string, contractorId: string, limit?: number): Promise<WorkflowExecution[]>;
  getWorkflowExecution(id: string, contractorId: string): Promise<WorkflowExecution | undefined>;
  getRecentWorkflowExecutions(contractorId: string, limit?: number): Promise<WorkflowExecution[]>;
  createWorkflowExecution(execution: Omit<InsertWorkflowExecution, 'contractorId'>, contractorId: string): Promise<WorkflowExecution>;
  updateWorkflowExecution(id: string, execution: UpdateWorkflowExecution, contractorId: string): Promise<WorkflowExecution | undefined>;
  
  // Enriched entity fetching for workflows (includes related contact data)
  getEstimateWithContact(id: string, contractorId: string): Promise<any>;
  getJobWithContact(id: string, contractorId: string): Promise<any>;
}

export const storage: IStorage = {
  ...userMethods,
  ...contactMethods,
  ...jobEstimateMethods,
  ...messagingMethods,
  ...integrationMethods,
  ...dialpadMethods,
  ...workflowMethods,
};
