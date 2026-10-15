# Assessment kit

This kit checks the REST API you built for your assessment and sends the result to your trainer.
It needs nothing except Node.js: **do not run `npm install`**.

## Before you start

1. Check Node.js: `node --version` must print **v18** or higher.
2. Run `npm run whoami`. The first time, type your registration number and the 6-digit PIN from your slip,
   then the set printed on your question paper (for example `A5`). If you typed anything wrong, run
   `npm run whoami -- --change`.
   Use your own laptop: the first laptop you log in from is registered to you.
   **Your PIN is personal. If it is used by anyone else, both students get zero for this assessment.**
   Build the API described in your question paper.

## Run the check

1. Start your API on port 8080 **with no data in it** (a fresh start, nothing created yet).
2. In this folder run:

   ```
   npm run evaluate
   ```

   If your API uses another address: `npm run evaluate -- --url http://localhost:3000`

3. Wait until it finishes. It lists each test case with its status, `PASS` or `FAIL`, then prints
   `Submission recorded. Your result has been sent to your trainer.` and a run id.

**Restart your server before every run**, so it starts empty again. If it is not empty the kit stops
and asks you to restart it; nothing is sent in that case.

The kit shows each test case as PASS or FAIL but **does not show marks**. Your trainer sees the
result. You may run it again after fixing your code; every run is sent to your trainer.

## If the result is not recorded

If you see `Your result is saved on this computer but NOT recorded yet`, tell the invigilator, then
run:

```
npm run submit-pending
```

The saved result is also sent automatically the next time you run `npm run evaluate`.
