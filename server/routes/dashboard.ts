import type { Express, Response } from "express";
import { storage } from "../storage";
import type { AuthenticatedRequest } from "../auth-service";

export function registerDashboardRoutes(app: Express): void {
  // Google Places API proxy — authenticated, server-side calls bypass browser referrer restrictions
  app.get('/api/places/autocomplete', async (req: AuthenticatedRequest, res: Response) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 3) {
      return res.json({ suggestions: [] });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'Referer': appUrl,
        },
        body: JSON.stringify({
          input: input.trim(),
          includedRegionCodes: ['us'],
        }),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Autocomplete] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json({ suggestions: data.suggestions || [] });
    } catch (e) {
      console.error('[Places Autocomplete] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  app.get('/api/places/details', async (req: AuthenticatedRequest, res: Response) => {
    const { placeId } = req.query as { placeId?: string };
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=formattedAddress,addressComponents`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'Referer': appUrl,
          },
        }
      );
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Details] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json(data);
    } catch (e) {
      console.error('[Places Details] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  // Dashboard metrics route
  app.get("/api/dashboard/metrics", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { timeframe, startDate, endDate } = req.query;

      let start: Date | undefined;
      let end: Date | undefined;

      const now = new Date();
      now.setHours(23, 59, 59, 999);

      if (timeframe === 'this_week') {
        start = new Date(now);
        const dayOfWeek = start.getDay();
        start.setDate(start.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'this_year') {
        start = new Date(now.getFullYear(), 0, 1);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'custom' && startDate && endDate) {
        start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
      }

      const metrics = await storage.getDashboardMetrics(
        req.user!.contractorId,
        req.user!.userId,
        req.user!.role,
        start,
        end
      );
      res.json(metrics);
    } catch (error) {
      console.error('Dashboard metrics error:', error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });
}
