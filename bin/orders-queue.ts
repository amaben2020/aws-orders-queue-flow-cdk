#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { OrdersQueueStack } from '../lib/orders-queue-stack';

const app = new cdk.App();
new OrdersQueueStack(app, 'OrdersQueueStack', {});
