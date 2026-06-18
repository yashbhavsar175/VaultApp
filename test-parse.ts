const { dryRunParseTransaction } = require('./src/lib/processors/TransactionProcessors');

const superMoneyBody = "₹88.00 received from RUSHIL SANJAYKUMAR BAROT Deposited in your Kotak bank on 17 June at 02:50 PM. Tap to view details";
const kotakBody = "Received Rs.88.00 in your Kotak Bank AC X1447 from samir.rushil@okaxis on 17-06-26.UPI Ref:653405954864.";

console.log("SUPER MONEY:", dryRunParseTransaction(superMoneyBody, "SUPERM"));
console.log("KOTAK:", dryRunParseTransaction(kotakBody, "AX-KOTAKB-S"));
