/** Donor-facing fold of the payment status machine (PR-D08).
 *
 * The system tracks nine payment statuses; a donor needs five. The fold
 * deliberately hides operational vocabulary — a donor is never shown
 * "dispute" or "chargeback", both land on the calm "under review" bucket
 * whose row action is a contact-us link. */

export type DonorPaymentStatus =
  | "completed"
  | "inProgress"
  | "notCompleted"
  | "refunded"
  | "underReview";

/** Display order for the filter chips: outcomes first, then the states
 * that still need something from someone. */
export const DONOR_PAYMENT_STATUSES: readonly DonorPaymentStatus[] = [
  "completed",
  "inProgress",
  "notCompleted",
  "refunded",
  "underReview",
];

const FOLD: Record<string, DonorPaymentStatus> = {
  completed: "completed",
  pending: "inProgress",
  processing: "inProgress",
  on_hold: "inProgress",
  failed: "notCompleted",
  refunded: "refunded",
  partially_refunded: "refunded",
  chargeback: "underReview",
  disputed: "underReview",
};

/** Fold a raw system status into the five donor-facing groups. A status
 * this build doesn't know (added server-side later) folds to
 * "inProgress" — the only bucket that neither celebrates nor alarms. */
export function foldPaymentStatus(status: string): DonorPaymentStatus {
  return FOLD[status] ?? "inProgress";
}
