import Stripe from "stripe";
import { env } from "../env";

let client: Stripe | null = null;

/** Lazy singleton — the app boots without a key; money paths demand one. */
export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}
