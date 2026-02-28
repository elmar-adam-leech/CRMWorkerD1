import { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { LeadCard } from "@/components/LeadCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Lead } from "@shared/schema";

interface KanbanColumn {
  id: string;
  title: string;
  status: "new" | "contacted" | "scheduled" | "disqualified";
  leads: Lead[];
}

interface LeadKanbanBoardProps {
  leads: Lead[];
  onStatusChange: (leadId: string, newStatus: string) => void;
  onViewDetails: (leadId: string) => void;
  onEdit: (leadId: string) => void;
  onContact: (leadId: string, method: "phone" | "email") => void;
  onSchedule: (leadId: string) => void;
  onSendText?: (lead: Lead) => void;
  onSendEmail?: (lead: Lead) => void;
  onEditStatus?: (leadId: string) => void;
  onSetFollowUp?: (lead: Lead) => void;
}

function SortableLeadCard({
  lead,
  onViewDetails,
  onEdit,
  onContact,
  onSchedule,
  onSendText,
  onSendEmail,
  onEditStatus,
  onSetFollowUp,
}: {
  lead: Lead;
  onViewDetails: (leadId: string) => void;
  onEdit: (leadId: string) => void;
  onContact: (leadId: string, method: "phone" | "email") => void;
  onSchedule: (leadId: string) => void;
  onSendText?: (lead: Lead) => void;
  onSendEmail?: (lead: Lead) => void;
  onEditStatus?: (leadId: string) => void;
  onSetFollowUp?: (lead: Lead) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="mb-3"
    >
      <LeadCard
        lead={lead}
        onViewDetails={onViewDetails}
        onEdit={onEdit}
        onContact={onContact}
        onSchedule={onSchedule}
        onSendText={onSendText}
        onSendEmail={onSendEmail}
        onEditStatus={onEditStatus}
        onSetFollowUp={onSetFollowUp}
        selectable={false}
      />
    </div>
  );
}

function KanbanColumnComponent({
  column,
  onViewDetails,
  onEdit,
  onContact,
  onSchedule,
  onSendText,
  onSendEmail,
  onEditStatus,
  onSetFollowUp,
}: {
  column: KanbanColumn;
  onViewDetails: (leadId: string) => void;
  onEdit: (leadId: string) => void;
  onContact: (leadId: string, method: "phone" | "email") => void;
  onSchedule: (leadId: string) => void;
  onSendText?: (lead: Lead) => void;
  onSendEmail?: (lead: Lead) => void;
  onEditStatus?: (leadId: string) => void;
  onSetFollowUp?: (lead: Lead) => void;
}) {
  return (
    <Card className="flex flex-col h-[calc(100vh-20rem)] min-w-[320px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{column.title}</CardTitle>
          <Badge variant="secondary">{column.leads.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-4 pb-4">
          <SortableContext
            items={column.leads.map((lead) => lead.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {column.leads.map((lead) => (
                <SortableLeadCard
                  key={lead.id}
                  lead={lead}
                  onViewDetails={onViewDetails}
                  onEdit={onEdit}
                  onContact={onContact}
                  onSchedule={onSchedule}
                  onSendText={onSendText}
                  onSendEmail={onSendEmail}
                  onEditStatus={onEditStatus}
                  onSetFollowUp={onSetFollowUp}
                />
              ))}
            </div>
          </SortableContext>
          {column.leads.length === 0 && (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No leads
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function LeadKanbanBoard({
  leads,
  onStatusChange,
  onViewDetails,
  onEdit,
  onContact,
  onSchedule,
  onSendText,
  onSendEmail,
  onEditStatus,
  onSetFollowUp,
}: LeadKanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [columns, setColumns] = useState<KanbanColumn[]>([
    { id: "new", title: "New Leads", status: "new", leads: [] },
    { id: "contacted", title: "Contacted", status: "contacted", leads: [] },
    { id: "scheduled", title: "Scheduled", status: "scheduled", leads: [] },
    { id: "disqualified", title: "Disqualified", status: "disqualified", leads: [] },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const organizeLeadsByStatus = () => {
    const organized: KanbanColumn[] = [
      { id: "new", title: "New Leads", status: "new", leads: [] },
      { id: "contacted", title: "Contacted", status: "contacted", leads: [] },
      { id: "scheduled", title: "Scheduled", status: "scheduled", leads: [] },
      { id: "disqualified", title: "Disqualified", status: "disqualified", leads: [] },
    ];

    leads.forEach((lead) => {
      const column = organized.find((col) => col.status === lead.status);
      if (column) {
        column.leads.push(lead);
      }
    });

    setColumns(organized);
  };

  useEffect(() => {
    organizeLeadsByStatus();
  }, [leads]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeLeadId = active.id as string;
    const overColumnId = over.id as string;

    const activeColumn = columns.find((col) =>
      col.leads.some((lead) => lead.id === activeLeadId)
    );
    const overColumn = columns.find(
      (col) => col.id === overColumnId || col.leads.some((lead) => lead.id === overColumnId)
    );

    if (!activeColumn || !overColumn) return;
    if (activeColumn.id === overColumn.id) return;

    const activeLead = activeColumn.leads.find((lead) => lead.id === activeLeadId);
    if (!activeLead) return;

    setColumns((prev) =>
      prev.map((col) => {
        if (col.id === activeColumn.id) {
          return {
            ...col,
            leads: col.leads.filter((lead) => lead.id !== activeLeadId),
          };
        }
        if (col.id === overColumn.id) {
          return {
            ...col,
            leads: [...col.leads, activeLead],
          };
        }
        return col;
      })
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      organizeLeadsByStatus();
      return;
    }

    const activeLeadId = active.id as string;
    const newColumn = columns.find(
      (col) => col.id === over.id || col.leads.some((lead) => lead.id === over.id)
    );

    if (newColumn) {
      const lead = leads.find((l) => l.id === activeLeadId);
      if (lead && lead.status !== newColumn.status) {
        onStatusChange(activeLeadId, newColumn.status);
      }
    }

    organizeLeadsByStatus();
  };

  const activeLead = activeId ? leads.find((lead) => lead.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <div key={column.id} className="flex-shrink-0">
            <KanbanColumnComponent
              column={column}
              onViewDetails={onViewDetails}
              onEdit={onEdit}
              onContact={onContact}
              onSchedule={onSchedule}
              onSendText={onSendText}
              onSendEmail={onSendEmail}
              onEditStatus={onEditStatus}
              onSetFollowUp={onSetFollowUp}
            />
          </div>
        ))}
      </div>
      <DragOverlay>
        {activeLead ? (
          <div className="opacity-90">
            <LeadCard
              lead={activeLead}
              onViewDetails={onViewDetails}
              onEdit={onEdit}
              onContact={onContact}
              onSchedule={onSchedule}
              onSendText={onSendText}
              onSendEmail={onSendEmail}
              onEditStatus={onEditStatus}
              onSetFollowUp={onSetFollowUp}
              selectable={false}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
