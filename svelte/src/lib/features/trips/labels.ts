import type { Doc } from '$convex/_generated/dataModel';
import type { BadgeVariant } from '$lib/primitives/ui/badge';
import * as m from '$lib/i18n/messages';

export type TripStatus = Doc<'trips'>['status'];
export type TripAttendeeStatus = Doc<'tripAttendees'>['status'];
export type TripDirection = Doc<'tripSegments'>['direction'];

export const TRIP_STATUSES = ['planning', 'confirmed', 'completed', 'cancelled'] as const;

export const TRIP_ATTENDEE_STATUSES = ['invited', 'confirmed', 'declined', 'cancelled'] as const;

export const TRIP_DIRECTIONS = ['outbound', 'return'] as const;

// Paraglide has no dynamic key access, so every union is mapped explicitly —
// the same shape `features/projects/labels.ts` uses.
export function tripStatusLabel(status: TripStatus): string {
	switch (status) {
		case 'planning':
			return m.tripStatus_planning();
		case 'confirmed':
			return m.tripStatus_confirmed();
		case 'completed':
			return m.tripStatus_completed();
		case 'cancelled':
			return m.tripStatus_cancelled();
	}
}

export function tripStatusVariant(status: TripStatus): BadgeVariant {
	switch (status) {
		case 'planning':
			return 'secondary';
		case 'confirmed':
			return 'success';
		case 'completed':
			return 'outline';
		case 'cancelled':
			return 'destructive';
	}
}

export function tripAttendeeStatusLabel(status: TripAttendeeStatus): string {
	switch (status) {
		case 'invited':
			return m.tripAttendeeStatus_invited();
		case 'confirmed':
			return m.tripAttendeeStatus_confirmed();
		case 'declined':
			return m.tripAttendeeStatus_declined();
		case 'cancelled':
			return m.tripAttendeeStatus_cancelled();
	}
}

export function tripAttendeeStatusVariant(status: TripAttendeeStatus): BadgeVariant {
	switch (status) {
		case 'invited':
			return 'secondary';
		case 'confirmed':
			return 'success';
		case 'declined':
			return 'outline';
		case 'cancelled':
			return 'destructive';
	}
}

export function tripDirectionLabel(direction: TripDirection): string {
	switch (direction) {
		case 'outbound':
			return m.tripDetail_outbound();
		case 'return':
			return m.tripDetail_return();
	}
}
