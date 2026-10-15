'use strict';
// Registration number and set validation. collector/assign.js is an identical copy.
// The set is not derived from the registration number: the student enters the set printed on their
// question paper (npm run whoami), because papers are handed out manually on assessment day.

const REG_REGEX = /^[A-Za-z0-9._/-]{4,20}$/;
const SET_REGEX = /^A([1-9]|10)$/;

function normalizeReg(reg) {
  return String(reg).trim().toUpperCase();
}

function isValidReg(reg) {
  return REG_REGEX.test(String(reg).trim());
}

function normalizeSet(set) {
  return String(set).trim().toUpperCase();
}

function isValidSet(set) {
  return SET_REGEX.test(normalizeSet(set));
}

module.exports = { REG_REGEX, SET_REGEX, normalizeReg, isValidReg, normalizeSet, isValidSet };
