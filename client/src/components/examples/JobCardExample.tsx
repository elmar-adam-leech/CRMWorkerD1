import { JobCard } from '../JobCard';

export default function JobCardExample() {
  // TODO: remove mock functionality
  const mockJob = {
    id: "job-1",
    title: "HVAC System Installation - Residential",
    customer: {
      name: "Sarah Johnson",
    },
    status: "in_progress" as const,
    value: 3500,
    scheduledDate: "Dec 15, 2024",
    type: "Installation",
    priority: "high" as const,
    estimatedHours: 6,
  };

  const handleStatusChange = (jobId: string, newStatus: string) => {
    console.log(`Changing status for job ${jobId} to ${newStatus}`);
  };

  const handleViewDetails = (jobId: string) => {
    console.log(`Viewing details for job ${jobId}`);
  };

  return (
    <div className="p-6 max-w-sm">
      <JobCard
        job={mockJob}
        onStatusChange={handleStatusChange}
        onViewDetails={handleViewDetails}
      />
    </div>
  );
}