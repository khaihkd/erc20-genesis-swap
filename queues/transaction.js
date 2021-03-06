'use strict'

const db = require('../models/mongodb')
const config = require('config')
const web3 = require('../models/blockchain/chain')
const consumer = {}

consumer.name = 'newTransaction'
consumer.task = async function(job, done) {
    let transactions = job.data.transactions
    let blockNumber = job.data.blockNumber
    let listTransactions = transactions.split(',')

    for (let j = 0; j < listTransactions.length; j++) {
        let hash = listTransactions[j]

        let transaction = await web3.eth.getTransactionReceipt(hash)
        if (transaction.status === false) {
            continue
        }
        console.log(' - Process transaction: ', hash)

        let logs = transaction.logs

        for (let i = 0; i < logs.length; i++) {
            let log = logs[i]
            if (log.address.toLowerCase() === config.get('tomoAddress')){
                // TODO: hashcode because this is for ERC20 transfer function
                if (log.topics[0].toLowerCase() === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                    let fromWallet = log.topics[1].replace('0x000000000000000000000000', '0x')
                    let toWallet = log.topics[2].replace('0x000000000000000000000000', '0x')
                    let tokenAmount = web3.utils.hexToNumberString(log.data) / 10 ** 18
                    console.log('  - Found Transfer', tokenAmount, ' TOMO from: ', fromWallet, ' to: ', toWallet)

                    let tran = await db.Transaction.findOne({hash: transaction.transactionHash, fromAccount: fromWallet})
                    if (tran && tran.isAddToken && tran.isSubToken) {
                        continue
                    }

                    // Update or make new transaction
                    await db.Transaction.findOneAndUpdate(
                        {hash: transaction.transactionHash, fromAccount: fromWallet, toAccount: toWallet},
                        {
                            hash: transaction.transactionHash,
                            block: transaction.blockNumber,
                            fromAccount: fromWallet,
                            toAccount: toWallet,
                            tokenAmount: tokenAmount
                        },
                        { upsert: true, new: true })

                    await db.Wallet.findOneAndUpdate({address: fromWallet}, {address: fromWallet}, { upsert: true, new: true })
                    await db.Wallet.findOneAndUpdate({address: toWallet}, {address: toWallet}, { upsert: true, new: true })

                    const q = require('./index')
                    await q.create('addAmountToWallet', {toWallet: toWallet, tokenAmount: tokenAmount})
                        .attempts(5).backoff({delay: 10000})
                        .priority('critical').removeOnComplete(true).save()

                    await q.create('subAmountFromWallet', {fromWallet: fromWallet, tokenAmount: tokenAmount})
                        .attempts(5).backoff({delay: 10000})
                        .priority('critical').removeOnComplete(true).save()

                }
            }

        }
    }
    console.log('Finish process block: ', blockNumber)

    await db.Block.findOneAndUpdate({blockNumber: blockNumber}, {isFinish: true}, { upsert: true, new: true })
    done()
};

module.exports = consumer