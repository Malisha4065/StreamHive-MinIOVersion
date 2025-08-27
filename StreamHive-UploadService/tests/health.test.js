const request = require('supertest')
const app = require('../src/server')

describe('Health Endpoints', () => {
  test('GET /health should return service health status', async () => {
    const response = await request(app)
      .get('/health')
      .expect('Content-Type', /json/)

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('status')
    expect(response.body).toHaveProperty('service', 'streamhive-upload-service')
    expect(response.body).toHaveProperty('timestamp')
  })

  test('GET /health/live should return liveness status', async () => {
    const response = await request(app)
      .get('/health/live')
      .expect('Content-Type', /json/)

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('status', 'alive')
  })
})
