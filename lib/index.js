/**
 * Dependencies
 */
const path = require('path');
const debug = require('debug')('metalsmith-mapsite')
const match = require('multimatch');
const pickby = require('lodash.pickby');
const slash = require('slash');
const { SitemapStream, streamToPromise } = require( 'sitemap' );
const { Readable } = require( 'stream' )

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
function plugin(opts){
	/**
	 * Init
	 */
	opts = opts || {};

	// Accept string option to specify the hostname
	if (typeof opts === 'string') {
		opts = { hostname: opts };
	}

	// A hostname should be specified
	if (!opts.hostname) {
		throw new Error('"hostname" option required');
	}

	// Map options to local variables and set defaults
	const changefreq = opts.changefreq || 'weekly';
	const hostname = opts.hostname;
	const lastmod = opts.lastmod;
	const omitExtension = opts.omitExtension;
	const omitIndex = opts.omitIndex;
	const output = opts.output || 'sitemap.xml';
	const pattern = opts.pattern || '**/*.html';
	const priority = isNaN(opts.priority) ? 0.5 : opts.priority; // priority might be 0.0 which evaluates to false

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
				return false;
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
				return chompRight(normalizedFile,path.extname(normalizedFile));
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

			// Create the sitemap entry (reject keys with falsy values)
			var entry = pickby({
				changefreq: frontmatter.changefreq || changefreq,
				priority: frontmatter.priority || priority,
				lastmod: frontmatter.lastmod || lastmod
			}, function(item) { return item; });

			if('lastmod' in entry) {
				entry.lastmod = new Date(entry.lastmod).toUTCString();
			}

			// Add the url (which is allowed to be falsy)
			entry.url = buildUrl(file, frontmatter);

			if (frontmatter.sitemap) Object.assign(entry, frontmatter.sitemap)

			debug(entry)

			// Add the entry to the sitemap
			links.push(entry);
		});

		// Create sitemap from array
		// https://www.npmjs.com/package/sitemap
		const stream = new SitemapStream( { hostname: hostname } )

		return streamToPromise(Readable.from(links).pipe(stream)).then((data) => {
			files[output] = {
        contents: Buffer.from(data.toString())
      };

      debug('wrote ' + links.length + ' urls to sitemap')
      done();
		});
	};
}
