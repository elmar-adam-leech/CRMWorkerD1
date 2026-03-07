import type { Request, Response } from "express";
import { storage } from "../storage";
import { CredentialService } from "../credential-service";
import type { Contractor } from "@shared/schema";

/**
 * Validates the contractor lookup and API key for all inbound webhook requests.
 *
 * Returns the contractor object if auth passes.
 * Returns null and writes the error response if auth fails — callers should
 * immediately `return` when they receive null:
 *
 *   const auth = await validateWebhookAuth(req, res, contractorId);
 *   if (!auth) return;
 *   const { contractor } = auth;
 */
export async function validateWebhookAuth(
  req: Request,
  res: Response,
  contractorId: string,
  logPrefix: string
): Promise<{ contractor: Contractor } | null> {
  const contractor = await storage.getContractor(contractorId);
  if (!contractor) {
    console.error(`[${logPrefix}] Invalid contractor ID:`, contractorId);
    res.status(404).json({
      error: "Contractor not found",
      message: "The specified contractor ID does not exist",
    });
    return null;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    res.status(401).json({
      error: "Missing API key",
      message: "Include your API key in the 'X-API-Key' header",
    });
    return null;
  }

  let storedApiKey: string | null;
  try {
    storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
  } catch {
    storedApiKey = null;
  }

  // If no key has been configured yet, reject and instruct the contractor
  // to generate their key via the authenticated settings panel.
  // Never auto-generate a key in response to an unauthenticated request.
  if (!storedApiKey) {
    res.status(401).json({
      error: "Webhook not configured",
      message: "No webhook API key has been set up for this contractor. Log in and generate your key from Settings > Webhooks.",
    });
    return null;
  }

  if (storedApiKey !== apiKey) {
    res.status(401).json({
      error: "Invalid API key",
      message: "The provided API key is not valid for this contractor",
    });
    return null;
  }

  return { contractor };
}

/**
 * Normalises the request body from external webhook senders.
 *
 * Different senders wrap the payload in different ways:
 *   - Some send `{ data: { ... } }` (e.g. Zapier, Make)
 *   - Some send `[ { ... } ]` (array of a single object)
 *   - Most send the object directly
 *
 * This helper always returns a plain object regardless of the wrapper format.
 */
export function parseWebhookPayload(req: Request): Record<string, unknown> {
  let data: unknown = req.body.data ?? req.body;
  if (Array.isArray(data) && data.length > 0) {
    data = data[0];
  }
  return (data as Record<string, unknown>) ?? {};
}
