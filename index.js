'use strict';

var bunyan = require('bunyan');
var logger = bunyan.createLogger({
    name: 'node-skype-jenkins-notifier',
    level: 'info'
});
logger.info('Starting node-skype-jenkins-notifier');

var _ = require('lodash');
var util = require('util');
var Skyweb = require('skyweb');
var cache = require('memory-cache');
var Promise = require('bluebird');
var rp = require('request-promise');
var credentials = require('./credentials.json');

// var twilio = require('twilio');  // Currently does not work on Debian 8 due to self-signed certificate
// Instead, manually use Twilio's REST API


// In Firefox, open the developer toolbar and "inject jQuery"
// Confluence team contact roster
// copy($('.confluenceTable > tbody:nth-child(1) > tr').map(function() { return {user: $(this).find('.userLogoLink').attr('data-username'), nameLast: $(this).find('> td:nth-child(2)').text(), nameFirst: $(this).find('> td:nth-child(3)').text(), skype: $(this).find('> td:nth-child(10)').text()}; }).get());
// Jenkins peopleAsync
// copy($('#people > tbody:nth-child(1) > tr').map(function() {return {user: $(this).find('td:nth-child(2) a').text()};}).get());

// Don't make manual changes to this file. Instead, edit teamContactRosterOverride.json
var teamContactRoster = require('./teamContactRoster.json');  // [ {"user": "jenkinsUsername": "skype": "skypeUsername"}, {...} ]
processTeamContactRoster();

var doNotCallList = require('./doNotCallList.json');  // ['skypeUsername1', 'skypeUsername2']
var JENKINS_STATUSES = ['SUCCESS', 'FAILURE', 'ABORTED', 'UNSTABLE', 'NOT_BUILT'];
var jenkinsHost = 'https://jenkins.example.com';
var jenkinsCheckIntervalMs = 60000;
var buildAcknowledgementCooldownMs = 600000;
var watchedBuilds = {
    'midtier-dev-build-master': {
        buildFamily: 'midtier'
    },
    'midtier-acceptance-test-build-master': {
        buildFamily: 'midtier'
    },
    'uilib-dev-build-master': {
        buildFamily: 'uilib'
    },
    'myapp-ui-dev-build-master': {
        buildFamily: 'myapp-ui'
    },
    'myapp-ui-acceptance-test-build-master': {
        buildFamily: 'myapp-ui'
    },
    'myapp-dev-build-master': {
        buildFamily: 'myapp'
    },
    'myapp-acceptance-test-build-master': {
        buildFamily: 'myapp'
    },
    // 'myapp-integration-test-build-master': {
    //     buildFamily: 'myapp'
    // }
    'midtier-dev-build-v2016.0-staging': {
        buildFamily: 'midtier'
    },
    'midtier-acceptance-test-build-v2016.0-staging': {
        buildFamily: 'midtier'
    },
    'uilib-dev-build-v2016.0-staging': {
        buildFamily: 'uilib'
    },
    'myapp-ui-dev-build-v2016.0-staging': {
        buildFamily: 'myapp-ui'
    },
    'myapp-ui-acceptance-test-build-v2016.0-staging': {
        buildFamily: 'myapp-ui'
    },
    'myapp-dev-build-v2016.0-staging': {
        buildFamily: 'myapp'
    },
    'myapp-acceptance-test-build-v2016.0-staging': {
        buildFamily: 'myapp'
    }
};

var lastAcknowledgements = {
    'myapp - less urgent topics': null,
    'myapp - pertinent to all': null
};

function processTeamContactRoster() {
    logger.debug('Begin processing team contact roster');
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
            return contact.user === customContact.user;
        });
    });
    teamContactRoster = _.concat(teamContactRoster, contactOverrides);
    logger.debug('End processing team contact roster');
}

var skyweb = new Skyweb();
logger.info({username: credentials.skypeUsername}, 'Logging in to Skype');
skyweb.login(credentials.skypeUsername, credentials.skypePassword)
    .then(function (skypeAccount) {
        logger.info({username: credentials.skypeUsername}, 'Logged in to Skype');
        // logger.trace({contacts: skyweb.contactsService.contacts});
    })
    // .then(function () {
    //     var recipientId = 'skypeusername143';
    //     var message = 'automated test message';
    //     skyweb.sendMessage('8:' + recipientId, message);
    // })
    .then(beginWatching);

function beginWatching() {
    logger.debug('beginWatching');
    // watchedBuilds['midtier-dev-build-master'].lastBuildStatus = 'SUCCESS';  // Test fake success
    // Preferable? All in 1 call: https://jenkins.example.com/view/Acc_master/api/json?pretty=true&depth=2&tree=jobs[lastCompletedBuild[result,url,culprits[absoluteUrl,id,fullName],actions[causes[userId,upstreamBuild,upstreamUrl]]]]
    _.each(watchedBuilds, function (value, job) {
        watchedBuilds[job].intervalId = setInterval(checkBuildStatus.bind(null, job), jenkinsCheckIntervalMs);
        checkBuildStatus(job);
    });
}

function checkBuildStatus(job) {
    logger.trace({job: job}, 'checkBuildStatus');
    getJenkinsBuildInfo('/job/' + job + '/lastCompletedBuild/api/json')
        .then(function (body) {
            // if (job === 'midtier-dev-build-master') {  // Test fake failure
            //     body = {
            //         "actions": [{
            //             "causes": [{
            //                 "upstreamBuild": 244,
            //                 "upstreamUrl": "job/myapp-acceptance-test-build-master/"
            //             }]
            //         }, {}, {}, {}, {}, {}, {}, {}, {}],
            //         "result": "FAILURE",
            //         "url": "https://jenkins.example.com/job/midtier-dev-build-master/324/",
            //         "culprits": [{  // Test recipients
            //             "absoluteUrl": "https://jenkins.example.com/user/first.last32",
            //             "fullName": "First Last32 (first.last32)",
            //             "id": "first.last32"
            //         }, {
            //             "absoluteUrl": "https://jenkins.example.com/user/first.last33",
            //             "fullName": "First Last33 (first.last33)",
            //             "id": "first.last33"
            //         }]
            //     };
            // }
            if (!_.isObject(body)) {
                logger.error({job: job, body: body}, 'Jenkins API returned bad JSON');
                return;
            }
            cleanEmptyActions(body);
            if (!isNewBuild(job, body)) {
                logger.trace({job: job, body: body}, 'Build status unchanged');
                return;
            }
            if (isNewFailure(job, body)) {
                return handleNewFailure(job, body);
            }
            if (isNewSuccess(job, body)) {
                return handleNewSuccess(job, body);
            }
            if (isNewAborted(job, body)) {
                return handleNewAborted(job, body);
            }
            if (isFirstStatus(job)) {
                return handleFirstStatus(job, body);
            }
            return updateBuildStatus(job, body);
        })
        .catch(function (err) {
            logger.error(err);
        });
}

function cleanEmptyActions(body) {
    // lots of empty object array items make the pretty-printed body long
    _.remove(body.actions, _.isEmpty);
}

function getJenkinsBuildInfo(buildUrl) {
    return rp({
        method: 'GET',
        baseUrl: jenkinsHost,
        url: buildUrl,
        // qs: {tree: 'result,url,culprits[absoluteUrl,id,fullName],actions[causes[userId,upstreamBuild,upstreamUrl,shortDescription]]'},
        qs: {tree: 'result,url,culprits[absoluteUrl,id,fullName],actions[causes[*]]'},
        json: true,
        forever: true,  // Prevent Error: getaddrinfo ENOTFOUND.
        auth: {
            username: credentials.jenkinsUsername,
            password: credentials.jenkinsApiToken
        }
    });
}

function isFirstStatus(job) {
    return _.isUndefined(watchedBuilds[job].lastBuildStatus);
}

function isNewAborted(job, body) {
    return body.result === 'ABORTED' && _.includes(_.without(JENKINS_STATUSES, 'ABORTED'), watchedBuilds[job].lastBuildStatus);
}

function isNewSuccess(job, body) {
    return body.result === 'SUCCESS' && _.includes(_.without(JENKINS_STATUSES, 'SUCCESS'), watchedBuilds[job].lastBuildStatus);
}

function isNewFailure(job, body) {
    return body.result === 'FAILURE' && watchedBuilds[job].lastBuildStatus === 'SUCCESS';
}

function isNewBuild(job, body) {
    return watchedBuilds[job].lastBuildUrl !== body.url;
}

function updateBuildStatus(job, body) {
    if (watchedBuilds[job].lastBuildUrl !== body.url) {
        watchedBuilds[job].lastBuildUrl = body.url;
        if (watchedBuilds[job].lastBuildStatus !== body.result) {
            logger.info({job: job, body: body}, 'New build. Build status changed');
            watchedBuilds[job].lastBuildStatus = body.result;
        } else {
            logger.trace({job: job, body: body}, 'New build. Build status unchanged');
        }
    } else {
        logger.trace({job: job, body: body}, 'Build status unchanged');
    }
}

function handleFirstStatus(job, body) {
    logger.info({job: job, status: body.result}, 'Setting initial build status');
    watchedBuilds[job].lastBuildUrl = body.url;
    watchedBuilds[job].lastBuildStatus = body.result;
}

function handleNewSuccess(job, body) {
    updateBuildStatus(job, body);
}

// {"name":"node-skype-jenkins-notifier","hostname":"a","pid":3503,"level":20,"job":"midtier-dev-build-master","body":{"result":"FAILURE","url":"https://jenkins.example.com/job/midtier-dev-build-master/324/","culprits":[{"absoluteUrl":"https://jenkins.example.com/user/first.last54","fullName":"First Last54 (first.last54)","id":"first.last54"},{"absoluteUrl":"https://jenkins.example.com/user/first.last55","fullName":"First Last55 (first.last55)","id":"first.last55"}]},"msg":"New failure","time":"2016-04-26T22:22:33.457Z","v":0}
function handleNewFailure(job, body) {
    updateBuildStatus(job, body);
    getCulpritSkypeUsernames(body, body.url)
        .then(sendFyi.bind(null, job, body))
        .catch(function (err) {
            logger.error(err, err.msg);
        });
}

function handleNewAborted(job, body) {
    updateBuildStatus(job, body);
}

function sendFyi(job, body, culpritSkypeUsernames) {
    _.each(culpritSkypeUsernames, function (skypeUsername) {
        if (_.includes(doNotCallList, skypeUsername)) {
            logger.info({
                recipient: skypeUsername,
                buildUrl: body.url
            }, 'Skipping FYI to people that do not want automated messages');
            return;
        }
        // if (!(skypeUsername === 'skypeusername32' || skypeUsername === 'skypeusername33')) {  // Test recipients
        //     skypeUsername = 'skypeusername32';
        // }
        // message += ' (ignore - testing)';
        if (isRedBuildFamilyAcknowledgedByUser(watchedBuilds[job.buildFamily], skypeUsername)) {
            logger.info({recipient: skypeUsername, buildUrl: body.url}, 'Skipping FYI, already claimed');
            return;
        }
        logger.info({recipient: skypeUsername, buildUrl: body.url}, 'Sending FYI');
        if (skypeUsername === 'skypeusername1') {
            return sendSmsToSelf();
        }
        var message = getNewFailureMessage(skypeUsername, body);
        skyweb.sendMessage('8:' + skypeUsername, message);
    });
}

function sendSmsToSelf() {
    // You can't send Skype messages to yourself, but I still want a notification that gets my attention
    rp({
        url: 'https://api.twilio.com/2010-04-01/Accounts/' + credentials.twilioAccountSid + '/Messages.json',
        method: 'POST',
        auth: {
            user: credentials.twilioApiKey,
            pass: credentials.twilioApiSecret
        },
        json: true,
        agentOptions: {
            rejectUnauthorized: false  // Not a big deal for now
        },
        useQuerystring: true,
        form: {
            To: '+15555556789',
            From: credentials.twilioNumber,
            Body: 'The build broke'
        },
        headers: {
            'Accept': 'application/json'
        }
    })
        .then(function (body) {
            logger.trace(body);
        })
        .catch(function (err) {
            logger.error(err);
        });
}

function getNewFailureMessage(username, body) {
    var messageTimestamps = cache.get(getCacheKey());
    var currentTime = new Date();
    var minute = 60 * 1000;
    var hour = 60 * minute;
    if (_.isEmpty(messageTimestamps)) {
        messageTimestamps = [];
        cache.put(getCacheKey(), messageTimestamps, 12 * hour);
        updateTimestamps();
        return 'FYI, one of your builds just failed: ' + body.url;
    }
    var lastTime = _.last(messageTimestamps);
    updateTimestamps();
    if (currentTime - (minute) < lastTime) {
        return 'and this: ' + body.url;
    }
    if (currentTime - (5 * minute) < lastTime) {
        return 'Another one of your builds failed: ' + body.url;
    }
    if (currentTime - (5 * hour) < lastTime) {
        return 'FYI, another one of your builds just failed: ' + body.url;
    }
    return 'FYI, one of your builds just failed: ' + body.url;

    function getCacheKey() {
        return 'message-timestamps:' + username;
    }

    function updateTimestamps() {
        messageTimestamps.push(currentTime);
        logger.debug({messageTimestamps: messageTimestamps, skypeUsername: username}, 'Message creation history');
    }
}

function getCulpritSkypeUsernames(body, rootBuildUrl) {
    var culpritSkypeUsernames = _.uniq(_.compact(_.map(body.culprits, function (culprit) {
        var person = _.find(teamContactRoster, function(contact) {
            return contact.user === String(culprit.id).toLowerCase();
        });
        if (_.isUndefined(person)) {
            logger.info({culprit: culprit}, 'Unknown culprit');
            return;
        }
        var skypeUsername = person.skype;
        if (_.isEmpty(skypeUsername)) {
            logger.info({culprit: culprit}, 'Unknown culprit');
            return;
        }
        if (_.includes(skypeUsername, '@')) {
            return getLiveUsername(skypeUsername, culprit);
        }
        return skypeUsername;
    })));
    if (!_.isEmpty(culpritSkypeUsernames)) {
        return Promise.resolve(culpritSkypeUsernames);
    } else if (!_.isEmpty(body.culprits)) {
        return Promise.reject({
            body: body,
            rootBuildUrl: rootBuildUrl,
            msg: 'The only culprits are unknown or ignored'
        });
    }
    var upstreamBuildCulpritPath = getUpstreamBuildCulpritPath(body);
    if (_.isUndefined(upstreamBuildCulpritPath)) {
        return Promise.reject({
            body: body,
            rootBuildUrl: rootBuildUrl,
            msg: 'No upstream build to check for culprits'
        });
    }
    return getJenkinsBuildInfo(upstreamBuildCulpritPath)
        .then(function (upstreamBody) {
            if (!_.isObject(upstreamBody)) {
                return Promise.reject({
                    body: upstreamBody,
                    rootBuildUrl: rootBuildUrl,
                    msg: 'Jenkins API returned bad JSON'
                });
            }
            return getCulpritSkypeUsernames(upstreamBody, rootBuildUrl);
        });
}

function getLiveUsername(skypeUsername, jenkinsCulprit) {
    var microsoftDomains = /@(?:hotmail|live|outlook|msn|passport)\.com$/;
    if (microsoftDomains.test(skypeUsername)) {
        var liveName = skypeUsername.replace(microsoftDomains, '');
        return 'live:' + liveName;
    }
    logger.info({culprit: jenkinsCulprit}, 'Not handling non-Microsoft email account');
}

function getUpstreamBuildCulpritPath(body) {
    var upstreamCause = _.find(_.get(_.find(body.actions, function(action) {
        return _.find(_.get(action, 'causes'), 'upstreamBuild');
    }), 'causes'), 'upstreamBuild');
    if (_.isUndefined(upstreamCause)) {
        return;
    }
    return util.format('/%s%s/api/json', upstreamCause.upstreamUrl, upstreamCause.upstreamBuild);
}

// {
//     "actions": [{
//         "causes": [{
//             "upstreamBuild": 244,
//             "upstreamUrl": "job/myapp-acceptance-test-build-master/"
//         }]
//     }, {}, {}, {}, {}, {}, {}, {}, {}],
//     "result": "FAILURE",
//     "url": "https://jenkins.example.com/job/midtier-acceptance-test-build-master/600/",
//     "culprits": []
// }

// {
//     "result": "SUCCESS",
//     "url": "https://jenkins.example.com/job/midtier-dev-build-master/321/",
//     "culprits": [{
//         "absoluteUrl": "https://jenkins.example.com/user/first.last60",
//         "fullName": "First Last60 (first.last60)",
//         "id": "first.last60"
//     }]
// }

skyweb.messagesCallback = function (messages) {
    logger.trace({messages: messages});
    _.each(messages, function (message) {
        checkAcknowledgementForMyappChannels(message);
    });
};

function checkAcknowledgementForMyappChannels(message) {
    if (!isTextMessage(message)) {
        return;
    }
    var threadtopic = _.get(message, 'resource.threadtopic', '').toLowerCase();
    if (!_.includes(['myapp - less urgent topics', 'myapp - pertinent to all'], threadtopic)) {
        return;
    }
    var composetime = _.get(message, 'resource.composetime');
    if (!composetime) {
        return;
    }
    var composeDate = new Date(composetime);
    var sender = getSender(message);
    if (_.isNull(sender)) {
        logger.error({message: message}, 'Unable to determine sender');
        return;
    }
    var content = _.get(message, 'resource.content');
    var acknowledgedBuildFamilies = getBuildFamiliesAcknowledged(content);
    if (_.isEmpty(acknowledgedBuildFamilies) && isBuildAmbiguouslyAcknowledged(message, threadtopic)) {
        markAmbiguouslyAcknowledgedBuilds(sender, composeDate, content, threadtopic);
    }
    if (!_.isEmpty(acknowledgedBuildFamilies)) {
        markAcknowledgedBuilds(sender, composeDate, content, threadtopic, acknowledgedBuildFamilies);
    }
}

function markAmbiguouslyAcknowledgedBuilds(sender, composeDate, content, threadtopic) {
    _.each(lastAcknowledgements[threadtopic].buildFamilies, function (buildFamily) {
        logger.info({
            buildFamily: buildFamily,
            skypeUsername: sender,
            composeDate: composeDate,
            message: content,
            context: lastAcknowledgements[threadtopic]
        }, 'Marking build ambiguously claimed by user');
        cache.put(getAcknowledgedCacheKey(buildFamily, sender), true, buildAcknowledgementCooldownMs);
    });
}

function markAcknowledgedBuilds(sender, composeDate, content, threadtopic, acknowledgedBuildFamilies) {
    _.each(acknowledgedBuildFamilies, function (buildFamily) {
        logger.info({
            buildFamily: buildFamily,
            skypeUsername: sender,
            composeDate: composeDate,
            message: content
        }, 'Marking build claimed by user');
        cache.put(getAcknowledgedCacheKey(buildFamily, sender), true, buildAcknowledgementCooldownMs);
    });
    lastAcknowledgements[threadtopic] = {
        skypeUsername: sender,
        composeDate: composeDate,
        message: content,
        buildFamilies: acknowledgedBuildFamilies
    }
}

function getBuildFamiliesAcknowledged(message) {
    var buildFamiliesAcknowledged = [];
    if (isBuildAcknowledged(/\builib\b/i, message)) {
        buildFamiliesAcknowledged.push('uilib');
    }
    if (isBuildAcknowledged(/\bmyapp-?ui\b/i, message)) {
        buildFamiliesAcknowledged.push('myapp-ui');
    }
    if (isBuildAcknowledged(/\bmidtier\b/i, message)) {
        buildFamiliesAcknowledged.push('midtier');
    }
    if (isBuildAcknowledged(/\bmyapp(?!-?ui)\b/i, message)) {
        buildFamiliesAcknowledged.push('myapp');
    }
    return buildFamiliesAcknowledged;
}

function isBuildAmbiguouslyAcknowledged(message, threadtopic) {
    return isAmbiguousAcknowledgement(message) && !_.isEmpty(lastAcknowledgements[threadtopic]);
}

function isAmbiguousAcknowledgement(message) {
    var claimed = _.some([
        /\bon it\b/i,
        /\bat it\b/i
    ], function(claimRegex) {
        return claimRegex.test(message);
    });
    return claimed;
}


function isBuildAcknowledged(buildFamilyRegex, message) {
    if (!buildFamilyRegex.test(message)) {
        return false;
    }
    if (/\bstaging\b/i.test(message)) {
        return false;
    }
    var claimed = _.some([
        /\bown/i,
        /\bclaim/i,
        /\bwork/i,
        /\bi\b.*\bon\b/i,
        /\bfix/i,
        /\bred\b/i,
        /\bfail/i,
        /\blook/i,
        /\bcheck/i,
        /\binvestigat/i,
        /\bmonitor/i
    ], function (claimRegex) {
        return claimRegex.test(message);
    });
    return claimed;
}

function getSender(message) {
    var from = _.get(message, 'resource.from');
    var skypeUsernameRegex = /\/8:(.*)$/;
    var skypeUsernameRegexResult = skypeUsernameRegex.exec(from);
    if (_.isNull(skypeUsernameRegexResult)) {
        return null;
    }
    var sender = skypeUsernameRegexResult[1];
    return sender;
}

function isTextMessage(message) {
    return _.includes(['RichText', 'Text'], _.get(message, 'resource.messagetype'));
}

function isRedBuildFamilyAcknowledgedByUser(buildFamily, skypeUsername) {
    return cache.get(getAcknowledgedCacheKey(buildFamily, skypeUsername)) || false;
}

function getAcknowledgedCacheKey(buildFamily, skypeUsername) {
    return util.format('%s:%s', buildFamily, skypeUsername);
}

// { messages:
//     [ { id: 1391,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:41:33Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername2/messages/1461706893321',
//         resource:
//         { id: '1461706893321',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461706893321/ack',
//             originalarrivaltime: '2016-04-26T21:41:33.257Z',
//             imdisplayname: 'skypeusername2',
//             messagetype: 'Control/ClearTyping',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername2',
//             composetime: '2016-04-26T21:41:33.257Z',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername2',
//             type: 'Message',
//             version: '1461706893321' } } ] }
// { messages:
//     [ { id: 1430,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:42:34Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143/messages/1461706954918',
//         resource:
//         { clientmessageid: '14719106850806471851',
//             messagetype: 'Text',
//             originalarrivaltime: '2016-04-26T21:42:34.930Z',
//             version: '1461706954918',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername1',
//             id: '1461706954918',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143',
//             type: 'Message',
//             imdisplayname: 'First Last1',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461706954918/ack',
//             content: 'no problem',
//             composetime: '2016-04-26T21:42:34.930Z' } } ] }
// { messages:
//     [ { id: 1434,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:42:45Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143/messages/1461706965262',
//         resource:
//         { id: '1461706965262',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461706965262/ack',
//             originalarrivaltime: '2016-04-26T21:42:45.265Z',
//             imdisplayname: 'First Last143',
//             messagetype: 'Control/Typing',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143',
//             composetime: '2016-04-26T21:42:45.265Z',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername143',
//             type: 'Message',
//             version: '1461706965262' } } ] }
// { messages:
//     [ { id: 1439,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:42:51Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143/messages/1461706971606',
//         resource:
//         { clientmessageid: '3350309985072284969',
//             messagetype: 'Text',
//             originalarrivaltime: '2016-04-26T21:42:51.593Z',
//             version: '1461706971606',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername143',
//             id: '1461706971606',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143',
//             type: 'Message',
//             imdisplayname: 'User 143',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461706971606/ack',
//             content: 'thanks',
//             composetime: '2016-04-26T21:42:51.593Z' } },
//         { id: 1440,
//             type: 'EventMessage',
//             resourceType: 'NewMessage',
//             time: '2016-04-26T21:42:51Z',
//             resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143/messages/1461706971653',
//             resource:
//             { id: '1461706971653',
//                 ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461706971653/ack',
//                 originalarrivaltime: '2016-04-26T21:42:51.640Z',
//                 imdisplayname: 'First Last143',
//                 messagetype: 'Control/ClearTyping',
//                 conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/8:skypeusername143',
//                 composetime: '2016-04-26T21:42:51.640Z',
//                 isactive: false,
//                 from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername143',
//                 type: 'Message',
//                 version: '1461706971653' } } ] }
// { messages:
//     [ { id: 1631,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:54:58Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:faked5578009c67b2842af9ec1e955cd@thread.skype/messages/1461707698692',
//         resource:
//         { id: '1461707698692',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461707698692/ack',
//             originalarrivaltime: '2016-04-26T21:54:58.655Z',
//             imdisplayname: 'some user',
//             messagetype: 'Control/Typing',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:faked5578009c67b2842af9ec1e955cd@thread.skype',
//             composetime: '2016-04-26T21:54:58.655Z',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername29',
//             type: 'Message',
//             threadtopic: 'MyApp - Less Urgent Topics',
//             version: '1461707698692' } } ] }
// { messages:
//     [ { id: 1641,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:55:34Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:faked5578009c67b2842af9ec1e955cd@thread.skype/messages/1461707734880',
//         resource:
//         { clientmessageid: '17702720150219903439',
//             threadtopic: 'MyApp - Less Urgent Topics',
//             messagetype: 'RichText',
//             originalarrivaltime: '2016-04-26T21:55:34.843Z',
//             version: '1461707734880',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername29',
//             id: '1461707734880',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:faked5578009c67b2842af9ec1e955cd@thread.skype',
//             type: 'Message',
//             imdisplayname: 'some user',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461707734880/ack',
//             content: 'something something',
//             composetime: '2016-04-26T21:55:34.843Z' } } ] }
// { messages:
//     [ { id: 1648,
//         type: 'EventMessage',
//         resourceType: 'NewMessage',
//         time: '2016-04-26T21:55:55Z',
//         resourceLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:faked5578009c67b2842af9ec1e955cd@thread.skype/messages/1461707755661',
//         resource:
//         { clientmessageid: '6540981161672430033',
//             threadtopic: 'MyApp - Less Urgent Topics',
//             messagetype: 'RichText/UriObject',
//             originalarrivaltime: '2016-04-26T21:55:54.562Z',
//             version: '1461707755661',
//             isactive: false,
//             from: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername29',
//             id: '1461707755661',
//             conversationLink: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:faked5578009c67b2842af9ec1e955cd@thread.skype',
//             type: 'Message',
//             imdisplayname: 'some user',
//             ackrequired: 'https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1461707755661/ack',
//             content: '<URIObject type="Picture.1" uri="https://api.asm.skype.com/v1/objects/0-cus-d2-fakecb3b36f42bc36afad5f92fe1bd19" url_thumbnail="https://api.asm.skype.com/v1/objects/0-cus-d2-fakecb3b36f42bc36afad5f92fe1bd19/views/imgt1">To view this shared photo, go to: <a href="https://login.skype.com/login/sso?go=xmmfallback?pic=0-cus-d2-fakecb3b36f42bc36afad5f92fe1bd19">https://login.skype.com/login/sso?go=xmmfallback?pic=0-cus-d2-fakecb3b36f42bc36afad5f92fe1bd19</a><OriginalName v="error.png"/><meta type="photo" originalName="error.png"/></URIObject>',
//             composetime: '2016-04-26T21:55:54.562Z' } } ] }

// {
//     "messages": [{
//         "id": 1505,
//         "type": "EventMessage",
//         "resourceType": "NewMessage",
//         "time": "2016-05-03T16:01:10Z",
//         "resourceLink": "https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:fakecd4966136a27450a11e108cfa7c5@thread.skype/messages/1462291268745",
//         "resource": {
//             "id": "1462291268745",
//             "ackrequired": "https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/ALL/messages/1462291268745/ack",
//             "originalarrivaltime": "2016-05-03T16:01:08.696Z",
//             "imdisplayname": "skypeusername47",
//             "messagetype": "Control/Typing",
//             "conversationLink": "https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/conversations/19:fakecd4966136a27450a11e108cfa7c5@thread.skype",
//             "composetime": "2016-05-03T16:01:08.696Z",
//             "isactive": false,
//             "from": "https://bn2-client-s.gateway.messenger.live.com/v1/users/ME/contacts/8:skypeusername47",
//             "type": "Message",
//             "threadtopic": "MyApp - Pertinent To All",
//             "version": "1462291268745"
//         }
//     }]
// }

