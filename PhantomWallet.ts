import uuid from 'react-native-uuid';
import * as Linking from "expo-linking";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    PublicKey,
    Transaction,
  } from "@solana/web3.js";
import { Buffer } from "buffer";
global.Buffer = global.Buffer || Buffer;


interface CallbackHandler{
    resolve: Function,
    reject: Function,
}

interface RegisteredCallbackHandler extends CallbackHandler {
    date: Date;
}

const enum DeepLinkMethod{
    connect="connect",
    disconnect="disconnect",
    signAndSendTransaction="signAndSendTransaction",
    signAllTransactions="signAllTransactions",
    signTransaction="signTransaction",
    signMessage="signMessage",
}


export default class PhantomWallet {
    private phantomCallbackMap = new Map<string,RegisteredCallbackHandler>(); //holds callback functions to be called after each return from a call to a Phantom deep link
    private phantomSession = {        
        token: '',
        keypair: nacl.box.keyPair(),
        shared_secret: new Uint8Array(0),
        wallet_pubkey: null,
    };
    private context = {
        cluster: '',
        phantom_app_url: 'https://phantom.app',
    };


    constructor(network: string) {
        if(!network)
            throw new Error("a network(devnet,testnet,mainnet-beta, etc...) must be specified.");

        this.context.cluster = network;
    }


    private buildUrl = (path: string, params: URLSearchParams) => `https://phantom.app/ul/v1/${path}?${params.toString()}`;

    private registerDeepLinkHandler  = (handler: CallbackHandler) : string => {
        this.unregisterOldDeepLinkHandlers(5); //unregister handlers that have been around longer than 5 minutes
        const callback_id = uuid.v4().toString(); //this will be used to identify that the callback is for this function call
        ////console.log('registering ', callback_id);
        this.phantomCallbackMap.set(callback_id, {...handler, date:new Date()}); //associate id with callback func
        return callback_id;
    }

    private unregisterDeepLinkHandler = (id: string) : boolean => this.phantomCallbackMap.delete(id);

    private getDeepLinkHandler = (id: string) => {
        const registeredHandler = this.phantomCallbackMap.get(id);
        return registeredHandler;
    }

    private unregisterOldDeepLinkHandlers = (minutes: number=5) =>{
        let keysToDelete = Array<string>();
        const now = new Date();
        this.phantomCallbackMap.forEach((k,registeredHandler: RegisteredCallbackHandler)=>{
            if(Math.abs(now - registeredHandler.date) > minutes) //delete if more than a x minutes has passed
                keysToDelete.push(k)
        });

        if(keysToDelete.length > 0){
            keysToDelete.forEach(k=>{
                ////console.log('deleting handler ', k);
                this.unregisterDeepLinkHandler(k)
            });
        }
    };

    private callDeepLinkMethod = (method: DeepLinkMethod, payload: any, callback_handler: CallbackHandler, deepLinkReturnRoute = "") => {    
        let errored = false;
        const walletPubkey = this.getWalletPublicKey();

        const params = new URLSearchParams({
            dapp_encryption_public_key: bs58.encode(this.phantomSession.keypair.publicKey), //this is not the wallet public key, this is used for key exchange encryption
        });

        if(method === DeepLinkMethod.connect){
            params.append("cluster", this.context.cluster);
            params.append("app_url", this.context.phantom_app_url);
        }
        else if(!walletPubkey) {
            callback_handler.reject('not connected to a Phantom wallet.');
            return;
        }
        
        if(payload) {
            const [nonce, encryptedPayload] = this.encryptPayload(payload, this.phantomSession.shared_secret);
            params.append("nonce", bs58.encode(nonce));
            params.append("payload", bs58.encode(encryptedPayload));
        }        
        
        const handlerId = this.registerDeepLinkHandler(callback_handler);
        const callbackLink = Linking.createURL(`${deepLinkReturnRoute}`, {queryParams:{ id: handlerId, method}});
        params.append("redirect_link", callbackLink);

        let url = this.buildUrl(method, params);

        const result = Linking
            .openURL(url)
            .then((result)=>{
                if(!result){
                    //unregisterDeepLinkHandler(handler_id);
                    callback_handler.reject(`Linking.openUrl failed. url=${url}`);
                    return;
                }
            })
            .catch(err=>{
                callback_handler.reject(err);
            });   
    }
 

    handleDeepLinkCallback = ({ url }: Linking.EventType) => {
        //console.log(`got callback: ${url}`)
        const u = new URL(url);
        let pathname = u.pathname;
        const params = u.searchParams;
        const errorCode = params.get("errorCode");
        const errorMessage = params.get("errorMessage")
        const handlerId = params.get("id");
        const method = params.get("method") ?? "";
    
        if(!handlerId)
            throw new Error(`Phantom didn't return the callback_id: ${url}`);

        const callbackHander = this.getDeepLinkHandler(handlerId);
        if(!callbackHander) {
            throw new Error(`a handler was not defined for handler_id ${handlerId}`);    
        }

        if (errorCode) {
            this.unregisterDeepLinkHandler(handlerId);
            callbackHander.reject(`Phantom returned error: ${errorCode}: ${errorMessage}`); 
                
            return;
        }

        //unregisterDeepLinkHandler(handlerId); //phantom doesn't always return the handlerId

        if (method.includes(DeepLinkMethod.signTransaction)) {
            //console.log('processing SignTransaction callback');
            const signTransactionData = this.decryptPayload(
                params.get("data")!,
                params.get("nonce")!,
                this.phantomSession.shared_secret
            );

            const decodedTransaction = Transaction.from(bs58.decode(signTransactionData.transaction));
            callbackHander.resolve(decodedTransaction);
        }
        else if (method.includes(DeepLinkMethod.signAndSendTransaction)) {
            //console.log('processing SignAndSendTransaction callback');
            const signAndSendTransactionData = this.decryptPayload(
                params.get("data")!,
                params.get("nonce")!,
                this.phantomSession.shared_secret
            );
    
            callbackHander.resolve(signAndSendTransactionData.signature);
        } 
        else if (method.includes(DeepLinkMethod.signAllTransactions)) {
            //console.log('processing SignAllTransactions callback');
            const signAllTransactionsData = this.decryptPayload(
                params.get("data")!,
                params.get("nonce")!,
                this.phantomSession.shared_secret
            );
    
            const decodedTransactions = signAllTransactionsData.transactions.map((t: string) =>
                Transaction.from(bs58.decode(t))
            );
    
            callbackHander.resolve(decodedTransactions);
        }
        else if (method.includes(DeepLinkMethod.signMessage)) {
            //console.log('processing SignMessage callback');
            const signMessageData = this.decryptPayload(
                params.get("data")!,
                params.get("nonce")!,
                this.phantomSession.shared_secret
            );
    
            callbackHander.resolve(signMessageData);
        }
        else if (method.includes(DeepLinkMethod.disconnect)) {
            //console.log('processing Disconnect callback');
            this.phantomSession.wallet_pubkey = null;
            callbackHander.resolve();
        }
        else if (method.includes(DeepLinkMethod.connect)) {
            //console.log('processing Connect callback');
            const sharedSecretDapp = nacl.box.before(
                bs58.decode(params.get("phantom_encryption_public_key")!),
                this.phantomSession.keypair.secretKey
            );
    
            const connectData = this.decryptPayload(
            params.get("data")!,
            params.get("nonce")!,
            sharedSecretDapp
            );

            const walletPubKey = new PublicKey(connectData.public_key);
            this.phantomSession.shared_secret = sharedSecretDapp;
            this.phantomSession.token = connectData.session;
            this.phantomSession.wallet_pubkey = walletPubKey;
            
            callbackHander.resolve(walletPubKey);
        }
        else {
            callbackHander.reject(`received unknown callback: ${url}`);
        }
    };


    private decryptPayload = (data: string, nonce: string, sharedSecret?: Uint8Array) => {
        if (!sharedSecret) throw new Error("missing shared secret");

        const decryptedData = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), sharedSecret);
        if (!decryptedData) {
            throw new Error("Unable to decrypt data");
        }
        return JSON.parse(Buffer.from(decryptedData).toString("utf8"));
    };


    encryptPayload = (payload: any, sharedSecret?: Uint8Array) => {
        if (!sharedSecret) throw new Error("missing shared secret");
    
        const nonce = nacl.randomBytes(24);
    
        const encryptedPayload = nacl.box.after(
            Buffer.from(JSON.stringify(payload)),
            nonce,
            sharedSecret
        );
    
        return [nonce, encryptedPayload];
    };



    /** gets the last retrieved wallet public key*/
    getWalletPublicKey = (): PublicKey|null => this.phantomSession.wallet_pubkey;

    /** connects to phantom wallet
     * @param deepLinkReturnRoute deeplink route back to the screen you want to display
    */
    connect = async (force=false, deepLinkReturnRoute = "") => {
        return new Promise<PublicKey>(async (resolve,reject) => {
            try
            {
                if(!this.phantomSession.token) 
                {
                    const initialUrl = await Linking.getInitialURL();
                    Linking.addEventListener("url", this.handleDeepLinkCallback);
                }
                
                if(this.phantomSession.token && !force)
                {
                    reject('already have a phantom session. set force=true to get a new session');
                    return;
                }

                this.callDeepLinkMethod(DeepLinkMethod.connect, null, {resolve, reject}, deepLinkReturnRoute);
            } 
            catch(err)
            {
                reject(err);
            }
        });
    }

    /** signs a transaction
     * @param deepLinkReturnRoute deeplink route back to the screen you want to display
    */
    signTransaction = async (transaction: Transaction, requireAllSignatures = true, verifySignatures = true, deepLinkReturnRoute = "") => {
        return new Promise<Transaction>(async (resolve, reject) => {
            if(!this.getWalletPublicKey()){
                reject('not connected to a wallet');
                return;
            }

            const serializedTransaction = bs58.encode(
                transaction.serialize({requireAllSignatures, verifySignatures})
            );

            const payload = {
                session: this.phantomSession.token,
                transaction: serializedTransaction,
            };

            this.callDeepLinkMethod(DeepLinkMethod.signTransaction, payload, {resolve, reject}, deepLinkReturnRoute);
        });
    }

    /** signs a message
    * @param deepLinkReturnRoute deeplink route back to the screen you want to display
    */
    signMessage = async (message: string, deepLinkReturnRoute = "") => {
        return new Promise<any>(async (resolve, reject) => {
            if(!this.getWalletPublicKey()){
                reject('not connected to a wallet');
                return;
            }     
            const payload = {
                session: this.phantomSession.token,
                message: bs58.encode(Buffer.from(message)),
            };

            this.callDeepLinkMethod(DeepLinkMethod.signMessage, payload, {resolve, reject}, deepLinkReturnRoute);
        });
    };

    /** signs and sends a transaction
    * @param deepLinkReturnRoute deeplink route back to the screen you want to display
    */
    signAndSendTransaction = async (transaction: Transaction, requireAllSignatures=true, verifySignatures=true, deepLinkReturnRoute = "") => {
        return new Promise<string>(async (resolve, reject) => {
            if(!this.getWalletPublicKey()){
                reject('not connected to a wallet');
                return;
            }

            const serializedTransaction = transaction.serialize({requireAllSignatures, verifySignatures});

            const payload = {
                session: this.phantomSession.token,
                transaction: bs58.encode(serializedTransaction),
            };

            this.callDeepLinkMethod(DeepLinkMethod.signAndSendTransaction, payload, {resolve, reject}, deepLinkReturnRoute);
        });
    };

    /** signs all transactions
    * @param deepLinkReturnRoute deeplink route back to the screen you want to display
    */
    signAllTransactions = async (transactions: Transaction[], requireAllSignatures=true, verifySignatures=true, deepLinkReturnRoute = "") => {
        return new Promise<Transaction[]>(async (resolve, reject) =>{ 
            if(!this.getWalletPublicKey()){
                reject('not connected to a wallet');
                return;
            }

            const serializedTransactions = transactions.map((t) =>
                bs58.encode(
                    t.serialize({requireAllSignatures, verifySignatures})
                )
            );

            const payload = {
                session: this.phantomSession.token,
                transactions: serializedTransactions,
            };

            this.callDeepLinkMethod(DeepLinkMethod.signAllTransactions, payload, {resolve, reject}, deepLinkReturnRoute);
        });
    };

    /** disconnects session from Phantom wallet
    * @param deepLinkReturnRoute deeplink route back to the screen you want to display
    */
    disconnect = async (deepLinkReturnRoute: string, ) => {
        return new Promise<void>(async (resolve,reject) =>{
            if(!this.getWalletPublicKey()){
                reject('not connected to a wallet');
                return;
            }

            const payload = {
                session: this.phantomSession.token,
            };

            this.callDeepLinkMethod(DeepLinkMethod.disconnect, payload, {resolve,reject}, deepLinkReturnRoute = "");
        });
  };
}