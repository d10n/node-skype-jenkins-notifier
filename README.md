# node-skype-jenkins-notifier

Disclaimer:  
This is the result of a perfect storm. There is certainly a better solution for your team.  
This tool has been retired since 2016 September.


Goal:  
Notify individual people on Skype when they broke the Jenkins build, but send the message from me and pretend to be me instead of a bot.  
We want to make sure that people are aware of their build breaking, and we don't want to be spammy. Send as few messages as necessary. If someone acknowledges a build failure, don't send messages to that person for a while.


Context:  
This was written for a 4-tier application where successful backend builds would kick off frontend builds.


Implementation summary:  
* Monitor team Skype channels for build failure acknowledgement.
* Poll Jenkins for updates. If the build was OK but just started failing, figure out who it was.
    * If the culprit has not already acknowledged the failure, send them an FYI.
    * If the culprit was me, send myself a text message. Skype won't let me send messages to myself.


* credentials.json has my account information
* doNotCallList.json is an array of Skype usernames not to message
* teamContactRoster.json is a generated array of objects matching Skype usernames ("skype" property) to Jenkins usernames ("user" property)
* teamContactRosterOverride.json is like teamContactRoster.json, but manually maintained
* jenkinsUsers.json is an array of objects having just a "user" property

When the configuration is all set, run.sh starts the program.
