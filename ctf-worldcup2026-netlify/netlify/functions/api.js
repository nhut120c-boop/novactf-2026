const serverless = require('serverless-http');
const app = require('../../src/app');

// binary: cần khai báo để multer/multipart form-data (upload file) không bị
// Netlify decode sai thành text.
exports.handler = serverless(app, {
  binary: ['multipart/form-data'],
});
