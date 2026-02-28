import { StatusBadge } from '../StatusBadge';

export default function StatusBadgeExample() {
  return (
    <div className="p-6 space-y-4">
      <h3 className="text-lg font-semibold">Status Badges</h3>
      <div className="flex flex-wrap gap-3">
        <StatusBadge status="new" />
        <StatusBadge status="scheduled" />
        <StatusBadge status="sent" />
        <StatusBadge status="approved" />
        <StatusBadge status="in_progress" />
        <StatusBadge status="completed" />
        <StatusBadge status="cancelled" />
      </div>
    </div>
  );
}