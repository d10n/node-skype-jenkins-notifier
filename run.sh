#!/bin/bash
nodejs index.js 2> >(tee -a node-skype-jenkins-notifier-stderr.log) | tee -a node-skype-jenkins-notifier-stdout.log | nodejs ./node_modules/.bin/bunyan
