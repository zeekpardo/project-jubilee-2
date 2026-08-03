<script lang="ts">
	// Sveltekit
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	// Svelte
	import { toast } from 'svelte-sonner';

	// API
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';

	// Components
	import EmailStep from './EmailStep.svelte';
	import PasswordFlow from './PasswordFlow.svelte';
	import EmailOtpFlow from './EmailOtpFlow.svelte';
	import MagicLinkFlow from './MagicLinkFlow.svelte';
	import SocialFlow from './SocialFlow.svelte';
	// Icons
	import MailIcon from '@lucide/svelte/icons/mail';

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';

	// Utils
	import { cn } from '$lib/primitives/utils';

	// Context
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { authConstants, authClient } = getAuthContext();

	// SvelteKit types
	import type { Pathname } from '$app/types';

	// Types
	type AuthStep =
		| 'email'
		| 'password-flow'
		| 'email-otp-flow'
		| 'magic-link-flow'
		| 'verify-email'
		| 'success';
	type EmailAuthMethod = 'password' | 'emailOTP' | 'magicLink';

	interface SignInProps {
		onSignIn?: () => void;
		redirectTo?: string;
		class?: string;
		/**
		 * When given, offer only these email methods, still intersected with what
		 * AUTH_CONSTANTS enables. A caller can narrow the offer but can never widen
		 * it: a method disabled globally stays disabled even when requested here,
		 * so this prop cannot be used to smuggle a provider back on.
		 *
		 * Omitting it must stay exactly equivalent to today, because /signin (staff)
		 * relies on the unrestricted behaviour.
		 */
		/**
		 * Suppress the card's own title and description on the email step.
		 *
		 * For a page that has already introduced itself. The card titles itself
		 * "Sign in into {brandName}" from AUTH_CONSTANTS, which is the PLATFORM's
		 * name — correct on /signin, and wrong beneath an org-branded heading on a
		 * donor's own charity's site, where it announces a product the donor has
		 * never heard of directly under the charity they came for.
		 *
		 * Deliberately narrow: the "Check your email" step keeps its header either
		 * way, because that one is not a title, it is the instruction telling
		 * someone the link is on its way.
		 */
		methods?: EmailAuthMethod[];
		hideHeader?: boolean;
	}

	let {
		onSignIn,
		redirectTo: redirectParam,
		class: className,
		methods: allowedMethods,
		hideHeader = false
	}: SignInProps = $props();

	// State
	let currentStep = $state<AuthStep>('email');
	let email = $state('');
	let submitting = $state(false);
	let availableEmailMethods = $state<EmailAuthMethod[]>([]);
	let isSigningIn = $state(false);
	let redirectInProgress = $state(false);
	let passwordMode = $state<'login' | 'register'>('login');
	let otpMode = $state<'login' | 'register'>('login');
	let verifyContext = $state<'emailVerification' | 'magicLink'>('emailVerification');
	let magicLinkSent = $state(false);
	let emailExistsRef = $state(false);

	// Auth state
	const auth = useAuth();
	const isAuthenticated = $derived(auth.isAuthenticated);
	const isLoading = $derived(auth.isLoading);

	// Initialize available methods
	$effect(() => {
		const methods: EmailAuthMethod[] = [];
		if (authConstants.providers.password) methods.push('password');
		if (authConstants.providers.emailOTP && authConstants.sendEmails) methods.push('emailOTP');
		if (authConstants.providers.magicLink && authConstants.sendEmails) methods.push('magicLink');
		// The `methods` prop only ever removes from what AUTH_CONSTANTS already
		// allowed. Filtering the computed list, rather than building a different
		// one, is what guarantees the omitted-prop path is unchanged and that a
		// globally disabled provider can never be requested back into existence.
		availableEmailMethods = allowedMethods
			? methods.filter((method) => allowedMethods.includes(method))
			: methods;
	});

	/**
	 * A caller asked for methods, and every one of them is disabled globally, so
	 * there is nothing to render in the email step. Showing the bare email field
	 * with no button under it looks like a broken form and leaves the visitor
	 * typing into a dead end, so we say so instead. Deliberately scoped to the
	 * restricted case: with the prop omitted, an empty list still renders exactly
	 * what it renders today (social providers only, or an empty card).
	 */
	const restrictedToNothing = $derived(
		allowedMethods !== undefined && availableEmailMethods.length === 0
	);

	// Legal links (handle empty/null/undefined gracefully)
	const termsUrl = $derived((authConstants.terms ?? '').trim());
	const privacyUrl = $derived((authConstants.privacy ?? '').trim());
	const showTerms = $derived(Boolean(termsUrl));
	const showPrivacy = $derived(Boolean(privacyUrl));
	const showLegal = $derived(showTerms || showPrivacy);
	const brandName = $derived((authConstants.brandName ?? 'self hosted Auth').trim());
	const brandTagline = $derived(
		(authConstants.brandTagline ?? 'Plug & Play Auth Widgets for your application.').trim()
	);

	// Monitor authentication state and redirect once Convex auth is synchronized
	$effect(() => {
		if (isAuthenticated && !isLoading && isSigningIn && !redirectInProgress) {
			redirectInProgress = true;
			// Always close the dialog when authenticated
			onSignIn?.();
			console.log('Convex auth synchronized, redirecting...');
			void finalizeSignIn();
		}
	});

	/**
	 * Gets the redirect URL based on redirectTo or current URL params
	 */
	function getRedirectURL(): string | undefined {
		if (redirectParam) return redirectParam;

		const redirectTo = page.url.searchParams.get('redirectTo');
		if (redirectTo) {
			return redirectTo;
		}

		if (page.url.pathname.includes('/signin')) {
			return '/';
		}
	}

	/**
	 * Handles the redirect after successful authentication
	 */
	async function handleRedirect(): Promise<'internal' | 'external' | 'none'> {
		const redirectURL = getRedirectURL();
		if (!redirectURL || typeof window === 'undefined') return 'none';

		try {
			const target = new URL(redirectURL, window.location.origin);
			if (target.origin === window.location.origin) {
				const internalPath = `${target.pathname}${target.search}${target.hash}`;
				await goto(resolve(internalPath as Pathname), { invalidateAll: true });
				return 'internal';
			}

			window.location.assign(target.toString());
			return 'external';
		} catch {
			if (redirectURL.startsWith('/')) {
				await goto(resolve(redirectURL as Pathname), { invalidateAll: true });
				return 'internal';
			}
		}

		return 'none';
	}

	/**
	 * Completes sign-in by keeping the loading UI active until navigation fully settles
	 */
	async function finalizeSignIn(): Promise<void> {
		let shouldResetState = true;

		try {
			const redirectMode = await handleRedirect();

			// External redirects unload the page, so keep the spinner visible until then.
			if (redirectMode === 'external') {
				shouldResetState = false;
				return;
			}
		} catch (error) {
			console.error('Sign-in redirect failed:', error);
		} finally {
			if (shouldResetState) {
				submitting = false;
				isSigningIn = false;
				redirectInProgress = false;
			}
		}
	}

	/**
	 * Handles successful authentication
	 */
	function handleAuthSuccess(): void {
		// Set flag to monitor auth state instead of immediate redirect
		submitting = true;
		isSigningIn = true;
	}

	/**
	 * Resets the flow back to email step
	 */
	function resetToEmailStep(): void {
		currentStep = 'email';
		email = '';
		submitting = false;
		isSigningIn = false;
		redirectInProgress = false;
		passwordMode = 'login';
		otpMode = 'login';
		verifyContext = 'emailVerification';
		magicLinkSent = false;
		emailExistsRef = false;
	}

	/**
	 * Handles method selection from email step
	 */
	async function handleMethodSelect(method: EmailAuthMethod, emailExists: boolean): Promise<void> {
		emailExistsRef = emailExists;

		// Existing user + magic link: send directly, skip MagicLinkFlow UI
		if (method === 'magicLink' && emailExists) {
			await authClient.signIn.magicLink(
				{
					email,
					callbackURL: getRedirectURL() || '/',
					errorCallbackURL: '/signin?error=magic-link-failed'
				},
				{
					onSuccess: () => {
						verifyContext = 'magicLink';
						magicLinkSent = true;
						isSigningIn = true;
						toast.success('Magic link sent to your email!');
					},
					onError: (ctx) => {
						console.error('Magic link send error:', ctx.error);
						toast.error(ctx.error.message || 'Failed to send magic link. Please try again.');
					}
				}
			);
			return;
		}

		// Email OTP: send OTP directly while EmailStep button shows "Sending..."
		if (method === 'emailOTP') {
			let otpSendSuccess = false;
			await authClient.emailOtp.sendVerificationOtp(
				{ email, type: 'sign-in' },
				{
					onSuccess: () => {
						otpSendSuccess = true;
						toast.success('Verification code sent to your email!');
					},
					onError: (ctx) => {
						console.error('OTP send error:', ctx.error);
						toast.error(ctx.error.message || 'Failed to send verification code. Please try again.');
					}
				}
			);
			if (otpSendSuccess) {
				otpMode = emailExists ? 'login' : 'register';
				currentStep = 'email-otp-flow';
			}
			return;
		}

		// Navigate to the appropriate step based on method
		switch (method) {
			case 'password':
				passwordMode = emailExists ? 'login' : 'register';
				currentStep = 'password-flow';
				break;
			case 'magicLink':
				currentStep = 'magic-link-flow';
				break;
		}
	}

	/**
	 * Gets the step title based on current step
	 */
	function getStepTitle(): string {
		switch (currentStep) {
			case 'password-flow':
				return passwordMode === 'register'
					? 'Create account with password'
					: 'Sign in with password';
			case 'email-otp-flow':
				return otpMode === 'register'
					? 'Create account with verification code'
					: 'Sign in with verification code';
			case 'magic-link-flow':
				return 'Sign in with magic link';
			default:
				return `Sign in into ${brandName}`;
		}
	}

	/**
	 * Gets the step description based on current step
	 */
	function getStepDescription(): string {
		switch (currentStep) {
			case 'password-flow':
				return passwordMode === 'register'
					? 'Create a password to continue.'
					: 'Enter your password to continue.';
			case 'email-otp-flow':
				return 'Enter the verification code we sent to your email address.';
			case 'magic-link-flow':
				return "We'll send a magic link to your email address.";
			default:
				return brandTagline;
		}
	}

	// Reset function that an external component can call
	export function reset() {
		resetToEmailStep();
	}

	// If the current step is no longer valid for the current config,
	// snap back to the email step so the UI always has something to render
	$effect(() => {
		const set = new Set(availableEmailMethods);

		const isPassword = currentStep === 'password-flow';
		const isOtp = currentStep === 'email-otp-flow';
		const isMagic = currentStep === 'magic-link-flow';
		const isVerifyEmail = currentStep === 'verify-email';

		// no email sending → no verify/magic/otp screens
		if (!authConstants.sendEmails && (isVerifyEmail || isMagic || isOtp)) {
			resetToEmailStep();
			return;
		}

		// step-specific availability checks
		if (isPassword && !set.has('password')) resetToEmailStep();
		if (isOtp && !set.has('emailOTP')) resetToEmailStep();
		if (isMagic && !set.has('magicLink')) resetToEmailStep();
	});
</script>

<div class={cn('mx-auto flex w-full max-w-md flex-col justify-center p-4', className)}>
	<Card.Root>
		{#if authConstants.sendEmails && (currentStep === 'verify-email' || (verifyContext === 'magicLink' && magicLinkSent))}
			<Card.Header>
				<!-- Circle -->
				<div class="mb-2 flex">
					<div class="bg-muted flex h-16 w-16 items-center justify-center rounded-full">
						<MailIcon class="text-muted-foreground size-8" />
					</div>
				</div>

				<Card.Title class="text-lg">Check your email</Card.Title>
				<Card.Description>
					{#if verifyContext === 'magicLink'}
						We've sent a magic link to <strong>{email}</strong>.
					{:else}
						We've sent a verification link to <strong>{email}</strong>.
					{/if}
					{#if verifyContext === 'magicLink'}
						Click the link in your email to sign in instantly.
					{:else}
						Click the link to verify your email. You'll be signed in automatically after
						verification.
					{/if}
				</Card.Description>
			</Card.Header>

			<Card.Content>
				<Button type="button" variant="secondary" class="w-full" onclick={resetToEmailStep}>
					Use a different email
				</Button>
			</Card.Content>
		{:else}
			{#if !hideHeader}
				<Card.Header>
					<Card.Title class="text-lg">{getStepTitle()}</Card.Title>
					<Card.Description>{getStepDescription()}</Card.Description>
				</Card.Header>
			{/if}

			<Card.Content class="flex flex-col gap-6">
				<!-- Social Sign In -->
				<SocialFlow
					show={currentStep === 'email'}
					onSuccess={handleAuthSuccess}
					onSubmittingChange={(value) => (submitting = value)}
					callbackURL={getRedirectURL() || '/'}
					dividerAfter={availableEmailMethods.length > 0}
				/>

				<!-- Email-based Auth Methods -->
				{#if restrictedToNothing}
					<p class="text-muted-foreground text-sm leading-relaxed">
						Sign-in by email is unavailable right now. Please contact support.
					</p>
				{:else if availableEmailMethods.length > 0}
					{#if currentStep === 'email'}
						<EmailStep
							{email}
							onEmailChange={(newEmail) => (email = newEmail)}
							onMethodSelect={handleMethodSelect}
							{submitting}
							availableMethods={availableEmailMethods}
						/>
					{:else if currentStep === 'password-flow'}
						<PasswordFlow
							{email}
							emailExists={emailExistsRef}
							onSuccess={handleAuthSuccess}
							onBack={resetToEmailStep}
							{submitting}
							onSubmittingChange={(value) => (submitting = value)}
							callbackURL={getRedirectURL() || '/'}
							onVerifyEmail={() => {
								currentStep = 'verify-email';
								verifyContext = 'emailVerification';
								isSigningIn = true;
							}}
						/>
					{:else if currentStep === 'email-otp-flow'}
						<EmailOtpFlow
							{email}
							emailExists={emailExistsRef}
							onSuccess={handleAuthSuccess}
							onBack={resetToEmailStep}
							{submitting}
							onSubmittingChange={(value) => (submitting = value)}
						/>
					{:else if currentStep === 'magic-link-flow'}
						<MagicLinkFlow
							{email}
							onBack={resetToEmailStep}
							{submitting}
							onSubmittingChange={(value) => (submitting = value)}
							callbackURL={getRedirectURL() || '/'}
							onLinkSent={() => {
								verifyContext = 'magicLink';
								magicLinkSent = true;
								isSigningIn = true;
							}}
						/>
					{/if}
				{/if}
			</Card.Content>

			{#if showLegal}
				<Card.Footer>
					<p class="text-muted-foreground text-xs">
						By continuing, you agree to our
						{#if showTerms}
							<a href={termsUrl} rel="external noreferrer" class="text-foreground underline"
								>Terms</a
							>
						{/if}
						{#if showTerms && showPrivacy}
							and
						{/if}
						{#if showPrivacy}
							<a href={privacyUrl} rel="external noreferrer" class="text-foreground underline"
								>Privacy Policies</a
							>
						{/if}
					</p>
				</Card.Footer>
			{/if}
		{/if}
	</Card.Root>
</div>
