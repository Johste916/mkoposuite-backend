// src/api/settings.js (or wherever this lives)
import api from "./index";

// Because api has baseURL that already ends with '/api', use just '/settings'
const P = (p) => `/settings/${p}`;

export const SettingsAPI = {
  // ----- Entity lists / CRUD -----
  // Loan Categories
  getLoanCategories: () => api.get(P("loan-categories")).then(r=>r.data),
  createLoanCategory: (p) => api.post(P("loan-categories"), p).then(r=>r.data),
  updateLoanCategory: (id,p) => api.put(P(`loan-categories/${id}`), p).then(r=>r.data),
  deleteLoanCategory: (id) => api.delete(P(`loan-categories/${id}`)).then(r=>r.data),

  // Branches (list + item update)
  getBranchSettings: () => api.get(P("branch-settings")).then(r=>r.data),
  updateBranch: (id,p) => api.put(P(`branch-settings/${id}`), p).then(r=>r.data),

  // Communications
  listComms: () => api.get(P("communications")).then(r=>r.data),
  createComm: (p) => api.post(P("communications"), p).then(r=>r.data),
  getComm: (id) => api.get(P(`communications/${id}`)).then(r=>r.data),
  updateComm: (id,p) => api.put(P(`communications/${id}`), p).then(r=>r.data),
  deleteComm: (id) => api.delete(P(`communications/${id}`)).then(r=>r.data),
  addCommAttachment: (id, formData) => api.post(P(`communications/${id}/attachments`), formData).then(r=>r.data),
  removeCommAttachment: (id, attId) => api.delete(P(`communications/${id}/attachments/${attId}`)).then(r=>r.data),

  // ----- Simple GET/PUT settings -----
  getGeneral: () => api.get(P("general")).then(r=>r.data),
  saveGeneral: (p) => api.put(P("general"), p).then(r=>r.data),

  getApiSettings: () => api.get(P("api")).then(r=>r.data),
  saveApiSettings: (p) => api.put(P("api"), p).then(r=>r.data),

  getSms: () => api.get(P("sms")).then(r=>r.data),
  saveSms: (p) => api.put(P("sms"), p).then(r=>r.data),

  getEmail: () => api.get(P("email")).then(r=>r.data),
  saveEmail: (p) => api.put(P("email"), p).then(r=>r.data),

  getBulkSms: () => api.get(P("bulk-sms-settings")).then(r=>r.data),
  saveBulkSms: (p) => api.put(P("bulk-sms-settings"), p).then(r=>r.data),

  getBorrowerSettings: () => api.get(P("borrower-settings")).then(r=>r.data),
  saveBorrowerSettings: (p) => api.put(P("borrower-settings"), p).then(r=>r.data),

  getLoanSettings: () => api.get(P("loan-settings")).then(r=>r.data),
  saveLoanSettings: (p) => api.put(P("loan-settings"), p).then(r=>r.data),

  getPenaltySettings: () => api.get(P("penalty-settings")).then(r=>r.data),
  savePenaltySettings: (p) => api.put(P("penalty-settings"), p).then(r=>r.data),

  getIntegrationSettings: () => api.get(P("integration-settings")).then(r=>r.data),
  saveIntegrationSettings: (p) => api.put(P("integration-settings"), p).then(r=>r.data),

  getSavingSettings: () => api.get(P("saving-settings")).then(r=>r.data),
  saveSavingSettings: (p) => api.put(P("saving-settings"), p).then(r=>r.data),

  getPayrollSettings: () => api.get(P("payroll-settings")).then(r=>r.data),
  savePayrollSettings: (p) => api.put(P("payroll-settings"), p).then(r=>r.data),

  getPaymentSettings: () => api.get(P("payment-settings")).then(r=>r.data),
  savePaymentSettings: (p) => api.put(P("payment-settings"), p).then(r=>r.data),

  getCommentSettings: () => api.get(P("comment-settings")).then(r=>r.data),
  saveCommentSettings: (p) => api.put(P("comment-settings"), p).then(r=>r.data),

  getDashboardSettings: () => api.get(P("dashboard-settings")).then(r=>r.data),
  saveDashboardSettings: (p) => api.put(P("dashboard-settings"), p).then(r=>r.data),

  getLoanSectorSettings: () => api.get(P("loan-sector-settings")).then(r=>r.data),
  saveLoanSectorSettings: (p) => api.put(P("loan-sector-settings"), p).then(r=>r.data),

  getIncomeSourceSettings: () => api.get(P("income-source-settings")).then(r=>r.data),
  saveIncomeSourceSettings: (p) => api.put(P("income-source-settings"), p).then(r=>r.data),

  getHolidaySettings: () => api.get(P("holiday-settings")).then(r=>r.data),
  saveHolidaySettings: (p) => api.put(P("holiday-settings"), p).then(r=>r.data),

  getLoanFees: () => api.get(P("loan-fees")).then(r=>r.data),
  saveLoanFees: (p) => api.put(P("loan-fees"), p).then(r=>r.data),

  getLoanReminders: () => api.get(P("loan-reminders")).then(r=>r.data),
  saveLoanReminders: (p) => api.put(P("loan-reminders"), p).then(r=>r.data),

  // user-management is treated as a settings blob
  getUsersSettings: () => api.get(P("user-management")).then(r=>r.data),
  saveUsersSettings: (p) => api.put(P("user-management"), p).then(r=>r.data),
};
