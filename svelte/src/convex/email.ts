import './polyfills';
import {
	renderVerifyEmail,
	renderMagicLink,
	renderVerifyOTP,
	renderResetPassword,
	renderChangeEmailVerification,
	renderInviteMember
} from './model/emails/templates/emailTemplates';
import { type ActionCtx } from './_generated/server';

import { Resend } from '@convex-dev/resend';
import { components } from './_generated/api';
import { AUTH_CONSTANTS } from './auth.constants';

const EMAIL_SEND_FROM = process.env.EMAIL_SEND_FROM;
const BRAND_LOGO_URL = process.env.BRAND_LOGO_URL;
const BRAND_NAME = process.env.BRAND_NAME?.trim() || AUTH_CONSTANTS.brandName;
const BRAND_TAGLINE = process.env.BRAND_TAGLINE?.trim() || AUTH_CONSTANTS.brandTagline;

export const resend: Resend = new Resend(components.resend, {
	testMode: false
});

/**
 * The verified sender, guarded at the point of use like every other send in
 * this file.
 *
 * Exported because donation receipts are sent from `stripe/receipts.ts` rather
 * than from here — they are triggered by a Stripe webhook, not by an auth
 * flow — and two modules disagreeing about the From address would mean
 * receipts silently failing DMARC while sign-in mail kept working.
 */
export function emailSendFrom(): string {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	return EMAIL_SEND_FROM;
}

/**
 * Brand chrome for the shared email shell, from the same env as auth mail.
 *
 * Every field is optional because `renderBaseEmail` supplies its own defaults,
 * and a deployment that has not set BRAND_* should get those rather than the
 * string "undefined" in its email header.
 */
export function emailBrand(): {
	brandName: string | undefined;
	brandTagline: string | undefined;
	brandLogoUrl: string | undefined;
} {
	return {
		brandName: BRAND_NAME,
		brandTagline: BRAND_TAGLINE,
		brandLogoUrl: BRAND_LOGO_URL
	};
}

export const sendEmailVerification = async (
	ctx: ActionCtx,
	{
		to,
		url
	}: {
		to: string;
		url: string;
	}
) => {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	await resend.sendEmail(ctx, {
		from: EMAIL_SEND_FROM,
		to,
		subject: 'Verify your email address',
		html: renderVerifyEmail({
			url,
			brandName: BRAND_NAME,
			brandTagline: BRAND_TAGLINE,
			brandLogoUrl: BRAND_LOGO_URL
		})
	});
};

export const sendOTPVerification = async (
	ctx: ActionCtx,
	{
		to,
		code
	}: {
		to: string;
		code: string;
	}
) => {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	await resend.sendEmail(ctx, {
		from: EMAIL_SEND_FROM,
		to,
		subject: `${code} is your verification code`,
		html: renderVerifyOTP({
			code,
			brandName: BRAND_NAME,
			brandTagline: BRAND_TAGLINE,
			brandLogoUrl: BRAND_LOGO_URL
		})
	});
};

export const sendMagicLink = async (
	ctx: ActionCtx,
	{
		to,
		url
	}: {
		to: string;
		url: string;
	}
) => {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	await resend.sendEmail(ctx, {
		from: EMAIL_SEND_FROM,
		to,
		subject: 'Sign in to your account',
		html: renderMagicLink({
			url,
			brandName: BRAND_NAME,
			brandTagline: BRAND_TAGLINE,
			brandLogoUrl: BRAND_LOGO_URL
		})
	});
};

export const sendResetPassword = async (
	ctx: ActionCtx,
	{
		to,
		url
	}: {
		to: string;
		url: string;
	}
) => {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	await resend.sendEmail(ctx, {
		from: EMAIL_SEND_FROM,
		to,
		subject: 'Reset your password',
		html: renderResetPassword({
			url,
			brandName: BRAND_NAME,
			brandTagline: BRAND_TAGLINE,
			brandLogoUrl: BRAND_LOGO_URL
		})
	});
};

export const sendChangeEmailVerification = async (
	ctx: ActionCtx,
	{
		to,
		url,
		newEmail,
		userName
	}: {
		to: string;
		url: string;
		newEmail: string;
		userName?: string;
	}
) => {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	await resend.sendEmail(ctx, {
		from: EMAIL_SEND_FROM,
		to,
		subject: 'Verify your new email address',
		html: renderChangeEmailVerification({
			url,
			newEmail,
			userName,
			brandName: BRAND_NAME,
			brandTagline: BRAND_TAGLINE,
			brandLogoUrl: BRAND_LOGO_URL
		})
	});
};

export const sendInviteMember = async (
	ctx: ActionCtx,
	{
		to,
		url,
		inviter,
		organization
	}: {
		to: string;
		url: string;
		inviter: {
			name: string;
			email: string;
			image?: string;
		};
		organization: {
			name: string;
			logo?: string;
		};
	}
) => {
	if (!EMAIL_SEND_FROM) {
		throw new Error('EMAIL_SEND_FROM environment variable is required but not set');
	}
	await resend.sendEmail(ctx, {
		from: EMAIL_SEND_FROM,
		to,
		subject: `Join ${organization.name} on ${BRAND_NAME}`,
		html: renderInviteMember({
			url,
			inviter,
			organization,
			brandName: BRAND_NAME,
			brandTagline: BRAND_TAGLINE,
			brandLogoUrl: BRAND_LOGO_URL
		})
	});
};
