import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

describe('lead survey_data', () => {
  async function createLead(token: string, name: string) {
    const res = await request(app).post('/api/leads').set(auth(token))
      .send({ name, phone: '555-0100' }).expect(201);
    return res.body as { id: string };
  }

  it('PATCH persists and returns survey_data', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const lead = await createLead(u.token, `Survey PATCH ${Date.now()}`);

    const survey = { jobType: 'swap-out', brand: 'Generac', base: 'stand-small', gasLine: true, notes: 'gate code 1234' };
    const res = await request(app).patch(`/api/leads/${lead.id}`).set(auth(u.token))
      .send({ survey_data: survey }).expect(200);

    expect(res.body.survey_data).toEqual(survey);
  });

  it('create-gen merges mapped survey fields into form_data', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const lead = await createLead(u.token, `Survey CreateGen ${Date.now()}`);

    const survey = { jobType: 'swap-out', brand: 'Generac', base: 'stand-small', gasLine: true, notes: 'gate code 1234' };
    await request(app).patch(`/api/leads/${lead.id}`).set(auth(u.token))
      .send({ survey_data: survey }).expect(200);

    const res = await request(app).post(`/api/leads/${lead.id}/create-gen`).set(auth(u.token)).expect(201);
    const formData = res.body.form_data;

    expect(formData.jobType).toBe('swap-out');
    expect(formData.brand).toBe('Generac');
    expect(formData.pad).toBe(false);
    expect(formData.genStand).toBe('small');
    expect(formData.gasLine).toBe(true);
    expect(formData.notes).toContain('gate code 1234');
  });

  it('create-gen with survey_data NULL behaves exactly as before', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const lead = await createLead(u.token, `Survey Null ${Date.now()}`);

    const res = await request(app).post(`/api/leads/${lead.id}/create-gen`).set(auth(u.token)).expect(201);
    const formData = res.body.form_data;

    expect(typeof formData.customer).toBe('string');
    expect(formData.customer.length).toBeGreaterThan(0);
    expect(formData.jobType).toBeUndefined();
    expect(formData.brand).toBeUndefined();
    expect(formData.pad).toBeUndefined();
    expect(formData.genStand).toBeUndefined();
    expect(formData.gasLine).toBeUndefined();
    expect(formData.phone).toBe('555-0100');
  });
});
