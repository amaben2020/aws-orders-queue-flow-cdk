import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { join } from 'path';
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

    // create a Lambda function that will process the orders, bind it to the event source
    const executeOrder = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'executeOrder',
      {
        entry: join(__dirname, 'executeOrder', 'handler.ts'),
        handler: 'handler',
        reservedConcurrentExecutions: 1,
        timeout: cdk.Duration.seconds(30), // I set a timeout of 30 seconds for the lambda function (for demo purposes, I want the fake processing to be very long), and the visibility timeout to 150 seconds: AWS recommends to set the visibility timeout to 6 times the timeout of your lambda
      }
    );
    executeOrder.addEventSource(eventSource);
  }
}
