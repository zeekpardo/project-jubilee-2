import { defineApp } from 'convex/server';
import resend from '@convex-dev/resend/convex.config';
import betterAuth from './betterAuth/convex.config';
import migrations from '@convex-dev/migrations/convex.config.js';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';

const app = defineApp();
app.use(resend);
app.use(betterAuth);
app.use(migrations);
// Guards the public donation endpoint, which is unauthenticated and takes an
// arbitrary amount — a perfect card-testing oracle otherwise. Hand-rolled
// counters admit races under exactly the concurrency an attack produces, which
// is why this is the component rather than a table of our own.
app.use(rateLimiter);

export default app;
