import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { join } from 'path';
import { orderExecutedHtmlTemplate } from '../email';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class OrdersQueueStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // create a FIFO SQS queue
    const ordersQueue = new cdk.aws_sqs.Queue(this, 'ordersQueue', {
      visibilityTimeout: cdk.Duration.seconds(180),
      fifo: true,
    });

    // defined an event source for the queue, with a batch size of 1
    const eventSource = new cdk.aws_lambda_event_sources.SqsEventSource(
      ordersQueue,
      {
        batchSize: 1, // Number of messages processed per invocation (default: 10, max: 10,000).
      }
    );

    // Provision a rest API
    const restApi = new cdk.aws_apigateway.RestApi(this, 'restApi', {});

    // Provision an event bus and a rule to trigger the notification Lambda function
    const ordersEventBus = new cdk.aws_events.EventBus(this, 'ordersEventBus');
    const notifyOrderExecutedRule = new cdk.aws_events.Rule(
      this,
      'notifyOrderExecutedRule',
      {
        eventBus: ordersEventBus,
        eventPattern: {
          source: ['notifyOrderExecuted'],
          detailType: ['orderExecuted'],
        },
      }
    );

    // Provision a SES template to send beautiful emails
    const orderExecutedTemplate = new cdk.aws_ses.CfnTemplate(
      this,
      'orderExecutedTemplate',
      {
        template: {
          htmlPart: orderExecutedHtmlTemplate,
          subjectPart: 'Your order was passed to our provider!',
          templateName: 'orderExecutedTemplate',
        },
      }
    );

    // This part is common to my SES article. No need to follow it if you already have a SES Identity
    const DOMAIN_NAME = 'pchol.fr';

    const hostedZone = new cdk.aws_route53.HostedZone(this, 'hostedZone', {
      zoneName: DOMAIN_NAME,
    });

    const identity = new cdk.aws_ses.EmailIdentity(this, 'sesIdentity', {
      identity: cdk.aws_ses.Identity.publicHostedZone(hostedZone),
    });

    // Create the request order lambda function
    const requestOrder = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'requestOrder',
      {
        entry: join(__dirname, 'requestOrder', 'handler.ts'),
        handler: 'handler',
        environment: {
          QUEUE_URL: ordersQueue.queueUrl,
        },
      }
    );

    // Grant the lambda function the right to send messages to the SQS queue, add API Gateway as a trigger
    ordersQueue.grantSendMessages(requestOrder);
    restApi.root
      .addResource('request-order')
      .addMethod(
        'POST',
        new cdk.aws_apigateway.LambdaIntegration(requestOrder)
      );

    // create a Lambda function that will process the orders, bind it to the event source
    const executeOrder = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'executeOrder',
      {
        entry: join(__dirname, 'executeOrder', 'handler.ts'),
        handler: 'handler',
        environment: {
          EVENT_BUS_NAME: ordersEventBus.eventBusName, // NEW: Add EVENT_BUS_NAME to the environment variables of the executeOrder lambda function
        },

        reservedConcurrentExecutions: 1,
        timeout: cdk.Duration.seconds(30), // I set a timeout of 30 seconds for the lambda function (for demo purposes, I want the fake processing to be very long), and the visibility timeout to 150 seconds: AWS recommends to set the visibility timeout to 6 times the timeout of your lambda
      }
    );

    executeOrder.addEventSource(eventSource);
    // NEW: grant the lambda function the right to put events to the event bus
    executeOrder.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [ordersEventBus.eventBusArn],
      })
    );

    // Create the notifyOrderExecuted lambda function
    const notifyOrderExecuted = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'notifyOrderExecuted',
      {
        entry: join(__dirname, 'notifyOrderExecuted', 'handler.ts'),
        handler: 'handler',
        environment: {
          SENDER_EMAIL: `contact@${identity.emailIdentityName}`,
          TEMPLATE_NAME: orderExecutedTemplate.ref,
        },
      }
    );

    // Grant the lambda function the right to send emails, add the lambda as a target of the event rule
    notifyOrderExecuted.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ses:SendTemplatedEmail'],
        resources: ['*'],
      })
    );
    notifyOrderExecutedRule.addTarget(
      new cdk.aws_events_targets.LambdaFunction(notifyOrderExecuted)
    );
  }
}
