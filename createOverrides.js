'use strict';

var _ = require('lodash');

var teamContactRoster = require('./teamContactRoster.json');
var jenkinsUsers = require('./jenkinsUsers.json');
processTeamContactRoster();

function processTeamContactRoster() {
    console.log('Begin processing team contact roster');
    var contactOverrides = require('./teamContactRosterOverride.json');
    teamContactRoster = _.map(teamContactRoster, function (contact) {
        contact.nameFirst && (contact.nameFirst = _.trim(contact.nameFirst));
        contact.nameLast && (contact.nameLast = _.trim(contact.nameLast));
        contact.skype && (contact.skype = _.trim(contact.skype));
        contact.user && (contact.user = _.trim(contact.user));
        return contact;
    });
    teamContactRoster = _.reject(teamContactRoster, function (contact) {
        return _.some(contactOverrides, function (customContact) {
            return contact.user && contact.user === customContact.user;
        });
    });
    teamContactRoster = _.concat(teamContactRoster, contactOverrides);
    console.log('End processing team contact roster');
}

teamContactRoster = _.filter(teamContactRoster, function (contact) {
    return _.isEmpty(_.trim(contact.skype)) && _.some(jenkinsUsers, function (jenkinsUser) {
            return contact.user === jenkinsUser.user;
        });
});
console.log(teamContactRoster);
// jenkinsUsers = _.reject(jenkinsUsers, function (jenkinsUser) {
//     return _.some(teamContactRoster, function(contact) {
//         return _.trim(jenkinsUser.user) === _.trim(contact.user);
//     });
// });
//
// console.log(JSON.stringify(jenkinsUsers));
