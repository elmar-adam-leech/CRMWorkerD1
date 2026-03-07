import type { Express, Response } from "express";
import { storage } from "../storage";
import type { AuthedRequest } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";
import { z } from "zod";
import { placesRateLimiter } from "../middleware/rate-limiter";

// Minimal types for the Google Places API v1 responses used in this file.
// Only fields actually consumed by the handlers are listed. See:
//   https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
interface GooglePlacesAutocompleteResponse {
  suggestions?: unknown[];
  error?: { message: string; status: string };
}
interface GooglePlacesDetailsResponse {
  formattedAddress?: string;
  addressComponents?: unknown[];
  error?: { message: string; status: string };
}

// Zod schema for the dashboard metrics query params.
// Validates timeframe and custom date range values before any Date construction,
// preventing silent NaN dates or 500 errors from malformed query strings.
const dashboardMetricsQuerySchema = z.object({
  timeframe: z.enum(['this_week', 'this_month', 'this_year', 'custom', 'all_time']).optional(),
  startDate: z.string().datetime({ offset: true }).optional().or(z.string().date().optional()),
  endDate: z.string().datetime({ offset: true }).optional().or(z.string().date().optional()),
});

export function registerDashboardRoutes(app: Express): void {
  // Google Places API proxy — authenticated, server-side calls bypass browser referrer restrictions.
  // `placesRateLimiter` enforces a per-IP limit of 30 req/min (stricter than the 300 req/min global
  // apiRateLimiter) because each call here consumes a paid Google API quota slot.
  app.get('/api/places/autocomplete', placesRateLimiter, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 3) {
      res.json({ suggestions: [] });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key not configured' });
      return;
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
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
    const data = await response.json() as GooglePlacesAutocompleteResponse;
    if (!response.ok) {
      console.error('[Places Autocomplete] API error:', data);
      res.status(502).json({ error: 'Places API error', details: data });
      return;
    }
    res.json({ suggestions: data.suggestions || [] });
  }));

  app.get('/api/places/details', placesRateLimiter, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { placeId } = req.query as { placeId?: string };
    if (!placeId) {
      res.status(400).json({ error: 'placeId is required' });
      return;
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Google Maps API key not configured' });
      return;
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
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
    const data = await response.json() as GooglePlacesDetailsResponse;
    if (!response.ok) {
      console.error('[Places Details] API error:', data);
      res.status(502).json({ error: 'Places API error', details: data });
      return;
    }
    res.json(data);
  }));

  // Dashboard metrics route
  app.get("/api/dashboard/metrics", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsed = dashboardMetricsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid query parameters" });
      return;
    }
    const { timeframe, startDate, endDate } = parsed.data;

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
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }

    const metrics = await storage.getDashboardMetrics(
      req.user.contractorId,
      req.user.userId,
      req.user.role,
      start,
      end
    );
    res.json(metrics);
  }));
}
