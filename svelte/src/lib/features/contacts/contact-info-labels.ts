import * as m from '$lib/i18n/messages';

// Shared across contactEmails and contactAddresses. contactPhones adds 'mobile'
// on top of this set — see PHONE_LOCATIONS below.
export const CONTACT_LOCATIONS = ['home', 'work', 'other'] as const;
export type ContactLocation = (typeof CONTACT_LOCATIONS)[number];

export const PHONE_LOCATIONS = ['home', 'work', 'mobile', 'other'] as const;
export type PhoneLocation = (typeof PHONE_LOCATIONS)[number];

const LOCATION_LABELS: Record<PhoneLocation, () => string> = {
	home: m.contactDetail_location_home,
	work: m.contactDetail_location_work,
	mobile: m.contactDetail_location_mobile,
	other: m.contactDetail_location_other
};

export function contactLocationLabel(location: string): string {
	return LOCATION_LABELS[location as PhoneLocation]?.() ?? location;
}

// Planning Center's numeric grade scale: 12..1, 0 = Kindergarten, -1 = Pre-K,
// -2/-3/-4 = Preschool 3s/2s/1s. Mirrors the comment on contacts.grade in
// schema.ts — only the number is stored, the label is a display concern.
export const GRADE_VALUES = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4] as const;
export type GradeValue = (typeof GRADE_VALUES)[number];

export function gradeLabel(value: number): string {
	switch (value) {
		case 0:
			return m.contactDetail_grade_kindergarten();
		case -1:
			return m.contactDetail_grade_prek();
		case -2:
			return m.contactDetail_grade_preschool3();
		case -3:
			return m.contactDetail_grade_preschool2();
		case -4:
			return m.contactDetail_grade_preschool1();
		default:
			return value >= 1 && value <= 12
				? m.contactDetail_grade_numbered({ number: value })
				: String(value);
	}
}
