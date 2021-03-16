/**
 * Dependencies
 */

const path = require('path');
const debug = require('debug')('metalsmith-mapsite')
const match = require('multimatch');
const pickby = require('lodash.pickby');
const slash = require('slash');
const beautify = require('xml-beautifier');
const {
	SitemapStream,
	streamToPromise
} = require('sitemap');
const {
	Readable
} = require('stream')

/**
 * Export plugin
 */
module.exports = plugin;

/**
 * Metalsmith plugin for generating a sitemap.
 *
 * @param {String or Object} options
 *	 @property {Date} lastmod (optional)
 *	 @property {String} changefreq (optional)
 *	 @property {Boolean} omitExtension (optional)
 *	 @property {Boolean} omitIndex (optional)
 *	 @property {String} hostname
 *	 @property {String} output (optional)
 *	 @property {String} pattern (optional)
 *	 @property {String} priority (optional)
 *	 @property {String} verbose (optional)
 * @return {Function}
 */
function plugin(opts) {
	/**
	 * Init
	 */
	opts = opts || {};

	// Accept string option to specify the hostname
	if (typeof opts === 'string') {
		opts = {
			hostname: opts
		};
	}

	// A hostname should be specified
	if (!opts.hostname) {
		throw new Error('"hostname" option required');
	}

	// Map options to local variables and set defaults
	const changefreq = opts.page_types.default.changefreq || 'weekly';
	const hostname = opts.hostname;
	const lastmod = opts.lastmod;
	const omitExtension = opts.omitExtension;
	const omitIndex = opts.omitIndex;
	const output = opts.output || 'sitemap.xml';
	const pattern = opts.pattern || '**/*.html';
	const omitPattern = opts.omitPattern || null;
	const overrides = opts.overrides || null;

	const priority = isNaN(opts.priority) ? 0.5 : opts.page_types.default.proirity; // priority might be 0.0 which evaluates to false
	const beautify_xml = opts.beautify || false;

	const chompRight = function(input, suffix) {
		if (input.endsWith(suffix)) {
			return input.slice(0, input.length - suffix.length);
		} else {
			return input;
		}
	};

	/**
	 * Main plugin function
	 */
	return function(files, metalsmith, done) {
		// Log urls we'll be including in the sitemap
		const links = [];

		// Checks whether files should be processed
		function check(file, frontmatter) {
			// Only process files that match the pattern
			if (!match(file, pattern)[0]) {
				if (/html/.test(file)) {
					// debug("No match for", file);
				}
				return false;
			}

			if (omitPattern) {
				if (match(file, omitPattern)[0]) {
					debug("Ignoring", file, "since it's in the omitPattern");
					return false;
				}
			}

			// Don't process private files
			if (frontmatter.private) {
				return false;
			}

			return true;
		}

		// Builds a url
		function buildUrl(file, frontmatter) {
			// Convert any windows backslash paths to slash paths
			const normalizedFile = slash(file);

			// Frontmatter settings take precedence
			if (typeof frontmatter.canonical === 'string') {
				return frontmatter.canonical;
			}

			// Remove index.html if necessary
			if (omitIndex && path.basename(normalizedFile) === 'index.html') {
				return chompRight(normalizedFile, 'index.html');
			}

			// Remove extension if necessary
			if (omitExtension) {
				return chompRight(normalizedFile, path.extname(normalizedFile));
			}

			// Otherwise just use the normalized 'file' entry
			return normalizedFile;
		}

		Object.keys(files).forEach(function(file) {
			// Get the current file's frontmatter
			const frontmatter = files[file];

			// Only process files that pass the check
			if (!check(file, frontmatter)) {
				return;
			}

			if (frontmatter.hasOwnProperty("date")) {
				frontmatter.lastmod = frontmatter.date;
			} else {
				frontmatter.lastmod = frontmatter.stats.mtime;
			}

			// Create the sitemap entry (reject keys with falsy values)

			if (frontmatter.page_type) {
				debug("PAGE TYPE", frontmatter.page_type, opts.page_types.hasOwnProperty(frontmatter.page_type))
			}

			if (frontmatter.hasOwnProperty("page_type") && opts.page_types.hasOwnProperty(frontmatter.page_type)) {
				frontmatter.changefreq = opts.page_types[frontmatter.page_type].changefreq;
				frontmatter.priority = opts.page_types[frontmatter.page_type].priority;
				debug("Setting priority for", file, "to page type", frontmatter.page_type);
			}

			var entry = pickby({
				changefreq: frontmatter.changefreq || changefreq,
				priority: frontmatter.priority || priority,
				lastmod: frontmatter.lastmod || lastmod
			}, function(item) {
				return item;
			});

			if (overrides && overrides.hasOwnProperty(file)) {
				debug("Found override for", file);
				const override = overrides[file];
				Object.keys(override).forEach(key => {
					entry[key] = override[key];
				});
			}


			if ('lastmod' in entry) {
				entry.lastmod = new Date(entry.lastmod).toUTCString();
			}

			// Add the url (which is allowed to be falsy)
			entry.url = buildUrl(file, frontmatter);

			if (frontmatter.sitemap) Object.assign(entry, frontmatter.sitemap)

			// Add the entry to the sitemap
			links.push(entry);
		});

		// Create sitemap from array
		// https://www.npmjs.com/package/sitemap
		const stream = new SitemapStream({
			hostname: hostname
		})

		return streamToPromise(Readable.from(links).pipe(stream)).then((data) => {
			let xml = data.toString();

			if (beautify_xml) {
				xml = beautify(xml);
			}

			files[output] = {
				contents: Buffer.from(xml)
			};

			debug('wrote ' + links.length + ' urls to sitemap')
			done();
		});
	};
}