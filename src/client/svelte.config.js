import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: '../../dist/client',
      assets: '../../dist/client',
      fallback: 'index.html',
      precompress: false,
      strict: false
    })
  }
};

export default config;
