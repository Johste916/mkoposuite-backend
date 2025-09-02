// src/api/admin.js
import api from "./index";

export const AdminAPI = {
  // TYPES
  listTypes: (category, params = {}) =>
    api.get("/api/admin/types", { params: { category, ...params } }).then(r => r.data),
  createType: (payload) =>
    api.post("/api/admin/types", payload).then(r => r.data),
  updateType: (id, payload) =>
    api.put(`/api/admin/types/${id}`, payload).then(r => r.data),
  deleteType: (id) =>
    api.delete(`/api/admin/types/${id}`).then(r => r.data),

  // TEMPLATES
  listTemplates: (channel, params = {}) =>
    api.get("/api/admin/templates", { params: { channel, ...params } }).then(r => r.data),
  createTemplate: (payload) =>
    api.post("/api/admin/templates", payload).then(r => r.data),
  updateTemplate: (id, payload) =>
    api.put(`/api/admin/templates/${id}`, payload).then(r => r.data),
  deleteTemplate: (id) =>
    api.delete(`/api/admin/templates/${id}`).then(r => r.data),
};
