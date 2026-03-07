import { useState } from "react";
import { logPersonalCall } from "@/lib/logPersonalCall";

export interface CommunicationEntity {
  id: string;
  name?: string | null;
  customerName?: string | null;
  emails?: string[] | null;
  phones?: string[] | null;
  email?: string | null;
  phone?: string | null;
}

export interface EmailModalState {
  isOpen: boolean;
  lead?: CommunicationEntity;
  estimate?: CommunicationEntity;
  customer?: CommunicationEntity;
}

export interface TextingModalState {
  isOpen: boolean;
  lead?: CommunicationEntity;
  estimate?: CommunicationEntity;
  customer?: CommunicationEntity;
}

export interface SchedulingModalState {
  isOpen: boolean;
  lead?: any;
}

export function useCommunicationActions() {
  const [emailModal, setEmailModal] = useState<EmailModalState>({ isOpen: false });
  const [textingModal, setTextingModal] = useState<TextingModalState>({ isOpen: false });
  const [schedulingModal, setSchedulingModal] = useState<SchedulingModalState>({ isOpen: false });

  const handleSendEmail = (entity: CommunicationEntity, entityType: 'lead' | 'estimate' | 'customer' = 'lead') => {
    const entityEmail = entity.emails && entity.emails.length > 0 ? entity.emails[0] : entity.email;
    
    if (!entityEmail) {
      console.log("No email address available for this entity");
      return;
    }
    
    const normalizedEntity = {
      ...entity,
      name: entity.name || entity.customerName || '',
    };
    
    if (entityType === 'lead') {
      setEmailModal({ isOpen: true, lead: normalizedEntity });
    } else if (entityType === 'estimate') {
      setEmailModal({ isOpen: true, estimate: normalizedEntity });
    } else {
      setEmailModal({ isOpen: true, customer: normalizedEntity });
    }
  };

  const handleSendText = (entity: CommunicationEntity, entityType: 'lead' | 'estimate' | 'customer' = 'lead') => {
    const entityPhone = entity.phones && entity.phones.length > 0 ? entity.phones[0] : entity.phone;
    
    if (!entityPhone) {
      console.log("No phone number available for this entity");
      return;
    }
    
    const normalizedEntity = {
      ...entity,
      name: entity.name || entity.customerName || '',
    };
    
    if (entityType === 'lead') {
      setTextingModal({ isOpen: true, lead: normalizedEntity });
    } else if (entityType === 'estimate') {
      setTextingModal({ isOpen: true, estimate: normalizedEntity });
    } else {
      setTextingModal({ isOpen: true, customer: normalizedEntity });
    }
  };

  const handleSchedule = (lead: any) => {
    // Convert to the expected format for the scheduling modal
    const modalLead = {
      id: lead.id,
      name: lead.name || lead.customerName,
      email: lead.emails && lead.emails.length > 0 ? lead.emails[0] : lead.email,
      phone: lead.phones && lead.phones.length > 0 ? lead.phones[0] : lead.phone,
      address: lead.address || undefined,
      isScheduled: lead.isScheduled || lead.status === 'scheduled' || false,
      housecallProEstimateId: lead.housecallProEstimateId || undefined,
    };
    
    setSchedulingModal({ isOpen: true, lead: modalLead });
  };

  const handleContact = (entity: CommunicationEntity, method: "phone" | "email") => {
    const entityPhone = entity.phones && entity.phones.length > 0 ? entity.phones[0] : entity.phone;
    const entityEmail = entity.emails && entity.emails.length > 0 ? entity.emails[0] : entity.email;
    
    if (method === "phone") {
      if (entityPhone) {
        logPersonalCall({ contactId: entity.id, phone: entityPhone, name: entity.name || entity.customerName || undefined });
        window.location.href = `tel:${entityPhone}`;
      } else {
        console.log("No phone number available for this entity");
      }
    } else if (method === "email") {
      if (entityEmail) {
        window.location.href = `mailto:${entityEmail}`;
      } else {
        console.log("No email address available for this entity");
      }
    }
  };

  const closeEmailModal = () => setEmailModal({ isOpen: false });
  const closeTextingModal = () => setTextingModal({ isOpen: false });
  const closeSchedulingModal = () => setSchedulingModal({ isOpen: false });

  return {
    // Modal states
    emailModal,
    textingModal,
    schedulingModal,
    
    // Handlers
    handleSendEmail,
    handleSendText,
    handleSchedule,
    handleContact,
    
    // Close handlers
    closeEmailModal,
    closeTextingModal,
    closeSchedulingModal,
  };
}
