import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../auth-service";
import { publicBookingRateLimiter, publicBookingSubmitRateLimiter } from "../middleware/rate-limiter";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";

export function registerPublicRoutes(app: Express): void {
  app.get('/sw-unregister', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Cache Clear</title>
          <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
          <meta http-equiv="Pragma" content="no-cache">
          <meta http-equiv="Expires" content="0">
      </head>
      <body>
          <h1>Clearing Browser Cache...</h1>
          <p id="status">Unregistering service workers...</p>
          <script>
              async function clearCache() {
                  const status = document.getElementById('status');
                  
                  try {
                      // Unregister all service workers
                      if ('serviceWorker' in navigator) {
                          const registrations = await navigator.serviceWorker.getRegistrations();
                          for (const registration of registrations) {
                              await registration.unregister();
                              console.log('Unregistered service worker:', registration);
                          }
                          status.innerHTML += '<br>✅ Service workers unregistered';
                      }
                      
                      // Clear all caches
                      if ('caches' in window) {
                          const cacheNames = await caches.keys();
                          await Promise.all(
                              cacheNames.map(cacheName => caches.delete(cacheName))
                          );
                          status.innerHTML += '<br>✅ All caches cleared';
                      }
                      
                      // Clear localStorage and sessionStorage
                      if (typeof Storage !== 'undefined') {
                          localStorage.clear();
                          sessionStorage.clear();
                          status.innerHTML += '<br>✅ Storage cleared';
                      }
                      
                      status.innerHTML += '<br><br><strong>✅ Cache clearing complete!</strong>';
                      status.innerHTML += '<br><a href="/">Return to Application</a>';
                      status.innerHTML += '<br><br><em>Note: You may need to hard refresh (Ctrl+Shift+R) after returning to the app.</em>';
                      
                  } catch (error) {
                      console.error('Cache clearing failed:', error);
                      status.innerHTML += '<br>❌ Error: ' + error.message;
                  }
              }
              
              clearCache();
          </script>
      </body>
      </html>
    `);
  });

  // =============================================
  // Public Booking API Routes (no authentication required)
  // =============================================

  // Public Google Places proxy — no auth required (used by public booking page)
  app.get('/api/public/places/autocomplete', publicBookingRateLimiter, async (req: Request, res: Response) => {
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
        console.error('[Places Autocomplete Public] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json({ suggestions: data.suggestions || [] });
    } catch (e) {
      console.error('[Places Autocomplete Public] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  app.get('/api/public/places/details', publicBookingRateLimiter, async (req: Request, res: Response) => {
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
        console.error('[Places Details Public] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json(data);
    } catch (e) {
      console.error('[Places Details Public] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  // Get contractor info and available slots for public booking page
  app.get("/api/public/book/:slug", publicBookingRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Return public contractor info (limited fields for security)
      res.json({
        contractor: {
          id: contractor.id,
          name: contractor.name,
          bookingSlug: contractor.bookingSlug,
        }
      });
    } catch (error) {
      console.error('[Public Booking] Error fetching contractor:', error);
      res.status(500).json({ message: "Failed to load booking page" });
    }
  });

  // Get available time slots for public booking
  app.get("/api/public/book/:slug/availability", publicBookingRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { startDate, endDate } = req.query;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Parse date range (default to next 14 days)
      const start = startDate ? new Date(startDate as string) : new Date();
      const end = endDate ? new Date(endDate as string) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      
      // Ensure start is not in the past
      const now = new Date();
      if (start < now) {
        start.setTime(now.getTime());
      }

      // Get available slots using the scheduling service with contractor's timezone
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
      const timezone = (contractor as any).timezone || 'America/New_York';
      const slots = await housecallSchedulingService.getUnifiedAvailability(contractor.id, start, end, timezone);
      
      // Return slots without revealing salesperson details (for privacy)
      const publicSlots = slots.map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        available: slot.availableSalespersonIds.length > 0,
      }));

      res.json({ slots: publicSlots });
    } catch (error) {
      console.error('[Public Booking] Error fetching availability:', error);
      res.status(500).json({ message: "Failed to load availability" });
    }
  });

  // Get contact info for prefilling public booking form
  app.get("/api/public/book/:slug/contact/:contactId", publicBookingRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug, contactId } = req.params;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Get the contact directly
      const contact = await storage.getContact(contactId, contractor.id);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }

      // Return only the fields needed for prefilling (no sensitive data)
      res.json({
        prefill: {
          name: contact.name,
          email: contact.emails?.[0] || '',
          phone: contact.phones?.[0] || '',
          address: contact.address || '',
        }
      });
    } catch (error) {
      console.error('[Public Booking] Error fetching contact for prefill:', error);
      res.status(500).json({ message: "Failed to load contact info" });
    }
  });

  // Create a booking from public page (stricter rate limit for submissions)
  app.post("/api/public/book/:slug", publicBookingSubmitRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { name, email, phone, address, customerAddressComponents, startTime, notes, source } = req.body;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Validate required fields
      if (!name || !startTime) {
        res.status(400).json({ message: "Name and appointment time are required" });
        return;
      }

      if (!email && !phone) {
        res.status(400).json({ message: "Email or phone number is required" });
        return;
      }

      // Parse and validate start time
      const appointmentStart = new Date(startTime);
      if (isNaN(appointmentStart.getTime())) {
        res.status(400).json({ message: "Invalid appointment time" });
        return;
      }

      // Ensure appointment is in the future
      if (appointmentStart < new Date()) {
        res.status(400).json({ message: "Appointment time must be in the future" });
        return;
      }

      // Create or find existing contact
      const emails = email ? [email] : [];
      const phones = phone ? [phone] : [];
      
      // Check for existing contact by email or phone
      let existingContactId = await storage.findMatchingContact(contractor.id, emails, phones);
      
      let contactId: string;
      if (existingContactId) {
        // Update existing contact
        contactId = existingContactId;
        await storage.updateContact(existingContactId, {
          name,
          emails,
          phones,
          address,
        }, contractor.id);
      } else {
        // Create new contact
        const newContact = await storage.createContact({
          name,
          emails,
          phones,
          address,
          type: 'lead',
          status: 'scheduled',
          source: source || 'public_booking',
        }, contractor.id);
        contactId = newContact.id;
      }

      // Book the appointment using the scheduling service
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
      const result = await housecallSchedulingService.bookAppointment(contractor.id, {
        startTime: appointmentStart,
        title: `Estimate Appointment - ${name}`,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        notes: notes || `Booked via public booking page`,
        contactId,
        customerAddressComponents: customerAddressComponents || undefined,
      });

      if (!result.success) {
        res.status(400).json({ message: result.error || "Failed to book appointment" });
        return;
      }

      // Update contact status
      await storage.updateContact(contactId, { status: 'scheduled', isScheduled: true }, contractor.id);

      res.json({ 
        success: true,
        message: "Appointment booked successfully",
        booking: {
          id: result.bookingId,
          startTime: appointmentStart.toISOString(),
          contactId,
        }
      });
    } catch (error) {
      console.error('[Public Booking] Error creating booking:', error);
      res.status(500).json({ message: "Failed to create booking" });
    }
  });

}
