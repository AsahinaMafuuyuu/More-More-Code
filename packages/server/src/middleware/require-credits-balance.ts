import { createMiddleware } from "hono/factory";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { reserveCredits, releaseReservation } from "../lib/credit-reservation";

export type CreditsReservationEnv = AuthenticatedEnv & {
    Variables: {
        reservationId: string;
    }
}

export const requireCreditsBalance = createMiddleware<CreditsReservationEnv>(
    async (c, next) => {
        let reservationId: string | undefined;

        try {
            const userId = c.get("userId");

            // Atomically reserve credits before proceeding
            const reservation = await reserveCredits({ userId });
            reservationId = reservation.reservationId;

            // Store reservation ID in context for reconciliation later
            c.set("reservationId", reservationId);

            await next();
        } catch (error) {
            // Release reservation if we created one
            if (reservationId) {
                try {
                    await releaseReservation(reservationId);
                } catch (releaseError) {
                    console.error("Failed to release credit reservation", {
                        reservationId,
                        error: releaseError,
                    });
                }
            }

            if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
                return c.json({
                    error: "Insufficient credits balance. \nRun /upgrade to add more credits."
                }, 402)
            }

            return c.json({
                error: "Unable to verify credits balance. \
                Please try again later."
            }, 503)
        }
    })