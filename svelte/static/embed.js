/**
 * Jubilee embed loader.
 *
 * Creates an <iframe> for each placeholder on the host page and keeps it the
 * height of its contents. It deliberately does NOT render into the host's DOM:
 * an iframe means the host's CSS cannot break the widget and the widget cannot
 * read the host's page, which is the right default for a script an org pastes
 * into a site we do not control.
 *
 *   <div data-jubilee-embed="grid"
 *        data-org="jubilee"
 *        data-campaign="project-jubilee"
 *        data-object="families"></div>
 *   <script src="https://your-app/embed.js" async></script>
 */
(function () {
	'use strict';

	// The app's own origin, taken from where this script was served rather than
	// hardcoded, so one file works across dev, staging and production.
	var script = document.currentScript;
	if (!script) return;
	var origin = new URL(script.src, window.location.href).origin;

	var INITIALISED = 'jubileeEmbedReady';

	function pathFor(node) {
		var kind = node.getAttribute('data-jubilee-embed');
		var org = node.getAttribute('data-org');
		var campaign = node.getAttribute('data-campaign');
		var object = node.getAttribute('data-object');
		var number = node.getAttribute('data-number');

		if (!org || !campaign) return null;

		if (kind === 'stats') return '/embed/' + org + '/' + campaign + '/stats';
		if (!object) return null;
		if (kind === 'grid') return '/embed/' + org + '/' + campaign + '/' + object;
		if (kind === 'record' && number) {
			return '/embed/' + org + '/' + campaign + '/' + object + '/' + number;
		}
		return null;
	}

	function mount(node) {
		if (node.dataset[INITIALISED]) return;
		var path = pathFor(node);
		if (!path) return;
		node.dataset[INITIALISED] = '1';

		var frame = document.createElement('iframe');
		frame.src = origin + path;
		frame.loading = 'lazy';
		frame.title = node.getAttribute('data-title') || 'Embedded content';
		frame.style.width = '100%';
		frame.style.border = '0';
		frame.style.display = 'block';
		// A holding height until the first measurement arrives, so the host page
		// does not jump from zero.
		frame.style.height = node.getAttribute('data-height') || '480px';
		node.appendChild(frame);
		return frame;
	}

	var frames = [];
	function mountAll() {
		var nodes = document.querySelectorAll('[data-jubilee-embed]');
		for (var i = 0; i < nodes.length; i++) {
			var frame = mount(nodes[i]);
			if (frame) frames.push(frame);
		}
	}

	window.addEventListener('message', function (event) {
		// Only ever trust a measurement that came from our own origin, and only
		// for a frame this script created — otherwise any page on the host could
		// resize these widgets by posting a message.
		if (event.origin !== origin) return;
		var data = event.data;
		if (!data || data.type !== 'jubilee-embed-height') return;
		if (typeof data.height !== 'number' || !isFinite(data.height) || data.height <= 0) return;

		for (var i = 0; i < frames.length; i++) {
			if (frames[i].contentWindow === event.source) {
				frames[i].style.height = Math.ceil(data.height) + 'px';
				return;
			}
		}
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', mountAll);
	} else {
		mountAll();
	}
})();
