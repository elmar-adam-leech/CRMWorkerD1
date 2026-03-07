import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse } from 'url';
import { IncomingMessage } from 'http';
import { AuthService } from './auth-service';
import { log } from './vite';
import { z } from 'zod';

// WebSocket message validation schemas
const wsMessageSchema = z.object({
  type: z.enum(['ping', 'subscribe', 'unsubscribe']),
  channel: z.string().optional(),
}).passthrough();

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  contractorId?: string;
  isAlive?: boolean;
}

let wss: WebSocketServer | null = null;

// Helper to extract token from cookies or query params
function extractToken(request: IncomingMessage): string | null {
  // Try to get from cookie header
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    if (cookies.auth_token) {
      return cookies.auth_token;
    }
  }
  
  // Try to get from query param (for clients that can't set cookies)
  const { query } = parse(request.url || '', true);
  if (query.token && typeof query.token === 'string') {
    return query.token;
  }
  
  return null;
}

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ 
    noServer: true,
    path: '/ws'
  });

  // Handle upgrade requests
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '');

    if (pathname === '/ws') {
      // Extract and verify JWT token
      const token = extractToken(request);
      
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const decoded = AuthService.verifyToken(token);
      if (!decoded) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Upgrade the connection
      wss!.handleUpgrade(request, socket, head, (ws: AuthenticatedWebSocket) => {
        ws.userId = decoded.userId;
        ws.contractorId = decoded.contractorId;
        ws.isAlive = true;
        
        wss!.emit('connection', ws, request);
      });
    }
    // Non-/ws paths: do nothing — Vite's HMR upgrade handler (registered earlier)
    // will process those connections. Destroying them here was breaking Vite HMR,
    // causing the page to reload every few seconds.
  });

  // Handle WebSocket connections
  wss.on('connection', (ws: AuthenticatedWebSocket) => {
    log(`[WebSocket] Client connected - User: ${ws.userId}, Contractor: ${ws.contractorId}`);

    // Send welcome message
    ws.send(JSON.stringify({ 
      type: 'connected',
      message: 'WebSocket connected successfully'
    }));

    // Heartbeat mechanism - respond to pings
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages with Zod validation
    ws.on('message', (message: string) => {
      try {
        const rawData = JSON.parse(message.toString());
        
        // Validate message structure
        const parseResult = wsMessageSchema.safeParse(rawData);
        if (!parseResult.success) {
          log(`[WebSocket] Invalid message schema: ${parseResult.error.message}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
          return;
        }
        
        const data = parseResult.data;
        
        // Handle ping from client
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        log(`[WebSocket] Invalid message format: ${error}`);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('error', (error) => {
      log(`[WebSocket] Error: ${error.message}`);
    });

    ws.on('close', () => {
      log(`[WebSocket] Client disconnected - User: ${ws.userId}`);
    });
  });

  // Heartbeat interval - ping clients every 30 seconds
  const heartbeatInterval = setInterval(() => {
    wss!.clients.forEach((ws: AuthenticatedWebSocket) => {
      if (ws.isAlive === false) {
        log(`[WebSocket] Terminating inactive connection - User: ${ws.userId}`);
        return ws.terminate();
      }
      
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  log('[WebSocket] Server initialized on path /ws');
}

// ─── Scaling Note ──────────────────────────────────────────────────────────
// The WebSocket server operates in single-process mode: `wss.clients` only
// contains connections on THIS Node.js process. If the app is ever scaled
// horizontally (multiple processes / pods), broadcasts will silently fail to
// reach clients connected to other processes.
//
// To fix this at scale, replace the in-process broadcast functions below with
// a Redis pub/sub fan-out (e.g. `ioredis` publish on the source process, and
// subscribe + re-broadcast on all worker processes). This requires zero changes
// to the broadcast call-sites — only the implementation here changes.
// ───────────────────────────────────────────────────────────────────────────

export interface WebSocketBroadcastPayload {
  type: string;
  [key: string]: unknown;
}

// Broadcast a message to all connected clients of a specific contractor
export function broadcastToContractor(contractorId: string, message: WebSocketBroadcastPayload) {
  if (!wss) {
    log('[WebSocket] Server not initialized, cannot broadcast');
    return;
  }

  let sentCount = 0;
  wss.clients.forEach((client: AuthenticatedWebSocket) => {
    if (client.contractorId === contractorId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
      sentCount++;
    }
  });

  log(`[WebSocket] Broadcasted message to ${sentCount} clients for contractor ${contractorId}`);
}

// Broadcast to a specific user
export function broadcastToUser(userId: string, message: WebSocketBroadcastPayload) {
  if (!wss) {
    log('[WebSocket] Server not initialized, cannot broadcast');
    return;
  }

  let sentCount = 0;
  wss.clients.forEach((client: AuthenticatedWebSocket) => {
    if (client.userId === userId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
      sentCount++;
    }
  });

  log(`[WebSocket] Broadcasted message to ${sentCount} clients for user ${userId}`);
}

export function getConnectedClientsCount(contractorId?: string): number {
  if (!wss) return 0;
  
  let count = 0;
  wss.clients.forEach((client: AuthenticatedWebSocket) => {
    if (!contractorId || client.contractorId === contractorId) {
      if (client.readyState === WebSocket.OPEN) {
        count++;
      }
    }
  });
  
  return count;
}
