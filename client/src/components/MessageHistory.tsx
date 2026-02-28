import { useEffect, useRef } from "react";
import { MessageSquare, ArrowDownLeft, ArrowUpRight } from "lucide-react";

interface Message {
  id: string;
  content: string;
  status: string;
  direction?: 'inbound' | 'outbound';
  createdAt: string | Date;
  toNumber?: string | null;
  fromNumber?: string | null;
  type?: string;
  userId?: string | null;
  userName?: string | null;
}

interface MessageHistoryProps {
  messages: Message[];
  isLoading: boolean;
  emptyStateMessage?: string;
  className?: string;
  filterType?: string;
  dataTestId?: string;
  contactPhone?: string;
}

export function MessageHistory({
  messages,
  isLoading,
  emptyStateMessage = "No messages yet",
  className = "",
  filterType,
  dataTestId = "message-history",
  contactPhone,
}: MessageHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const formatTimestamp = (timestamp: string | Date) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffHours / 24;
    if (diffHours < 1) {
      return `${Math.floor(diffMs / (1000 * 60))}m ago`;
    } else if (diffHours < 24) {
      return `${Math.floor(diffHours)}h ago`;
    } else if (diffDays < 7) {
      return `${Math.floor(diffDays)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    } else if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  // Filter messages if filterType is provided
  const filteredMessages = filterType
    ? messages.filter(msg => msg.type === filterType)
    : messages;
  
  console.log(`[MessageHistory] Total messages: ${messages.length}, Filtered (${filterType}): ${filteredMessages.length}`);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages]);

  return (
    <div className={`h-full border rounded-md overflow-hidden bg-muted/20 flex flex-col ${className}`} data-testid={dataTestId}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground" data-testid="loading-messages">
            Loading messages...
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground" data-testid="no-messages">
            {emptyStateMessage}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMessages.map((msg) => {
              let isInbound = msg.direction === 'inbound';
              // Fallback logic for SMS if direction is not set
              if (!msg.direction && filterType === 'text' && contactPhone && msg.fromNumber) {
                isInbound = msg.fromNumber === contactPhone;
              }
              return (
                <div key={msg.id} className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] ${isInbound ? 'bg-muted' : 'bg-primary text-primary-foreground'} rounded-lg p-3`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        {isInbound ? (
                          <ArrowDownLeft className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3 shrink-0" />
                        )}
                        <span className="text-xs font-medium">
                          {isInbound ? 'Received' : 'Sent'}
                          {isInbound && msg.fromNumber && (
                            <span className="opacity-80 ml-1">
                              from {formatPhoneNumber(msg.fromNumber)}
                            </span>
                          )}
                          {isInbound && msg.toNumber && (
                            <span className="opacity-80 ml-1">
                              to {formatPhoneNumber(msg.toNumber)}
                            </span>
                          )}
                          {!isInbound && msg.fromNumber && (
                            <span className="opacity-80 ml-1">
                              from {formatPhoneNumber(msg.fromNumber)}
                            </span>
                          )}
                          {!isInbound && msg.toNumber && (
                            <span className="opacity-80 ml-1">
                              to {formatPhoneNumber(msg.toNumber)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="text-sm leading-relaxed mb-1.5" data-testid={`message-${msg.id}`}>
                        {msg.type === 'email' ? (
                          <div
                            className={`prose prose-sm max-w-none ${isInbound ? 'dark:prose-invert' : 'prose-invert'}`}
                            dangerouslySetInnerHTML={{ __html: msg.content }}
                          />
                        ) : (
                          msg.content
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs opacity-70">
                            {formatTimestamp(msg.createdAt)}
                          </span>
                          {!isInbound && msg.userName && (
                            <span className="text-xs opacity-70">
                              by {msg.userName}
                            </span>
                          )}
                        </div>
                        {!isInbound && (
                          <div className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                            msg.status === 'sent' || msg.status === 'delivered'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                              : msg.status === 'failed'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                          }`}>
                            {msg.status}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

export default MessageHistory;