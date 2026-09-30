import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import fs from "fs";
import bcrypt from "bcrypt";
import axios from "axios";
import nodemailer from "nodemailer";
import appARouter from "./appA/appA.js";

dotenv.config();

const app = express();


// ============================================================
// BASIC MIDDLEWARE
// ============================================================

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cors());

app.use(express.json());

app.use(bodyParser.json({ limit: "50mb" }));

app.use(
    bodyParser.urlencoded({
        limit: "50mb",
        extended: true
    })
);

app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS"
    );

    next();

});


const PORT =
    process.env.PORT || 8080;


// ============================================================
// FIREBASE
// ============================================================

const serviceAccount =
    JSON.parse(
        fs.readFileSync(
            "futur-e-saas-firebase-adminsdk-fbsvc-3eac3fd621.json",
            "utf8"
        )
    );


const mainApp =
    admin.initializeApp(
        {
            credential:
                admin.credential.cert(
                    serviceAccount
                ),

            storageBucket:
                "futur-e-saas-docs"
        },
        "main"
    );


const db =
    mainApp.firestore();


const bucket =
    mainApp.storage().bucket();


// ============================================================
// HISTORY / AUDIT LOGGING
// ============================================================

function logHistory(
    route,
    action,
    user,
    status = "success"
) {

    const historyEntry = {

        route,

        action,

        user:
            user ||
            "Unauthenticated",

        status,

        timestamp:
            new Date()

    };


    db.collection("history")
        .add(historyEntry)
        .catch(error => {

            console.error(
                "History error:",
                error
            );

        });

}


// ============================================================
// GLOBAL AUDIT LOGGER
// ============================================================
//
// Every request goes through this middleware.
//
// It logs:
//
// GET
// POST
// PATCH
// DELETE
//
// including:
//
// - authenticated user
// - route
// - HTTP method
// - response status
// - success/error
// - timestamp
//
// OPTIONS requests are ignored.
// Passwords, OTPs and tokens are NEVER logged.
//

app.use(
    (req, res, next) => {

        if (
            req.method ===
            "OPTIONS"
        ) {

            return next();

        }


        const startTime =
            Date.now();


        res.on(
            "finish",
            () => {

                const duration =
                    Date.now() -
                    startTime;


                const username =
                    req.user?.username ||
                    req.body?.username ||
                    "Unauthenticated";


                let status =
                    "success";


                if (
                    res.statusCode >= 400
                ) {

                    status =
                        "error";

                }


                const method =
                    req.method;


                const route =
                    req.originalUrl ||
                    req.url;


                const action =
                    `${method} ${route}`;


                logHistory(

                    route,

                    action,

                    username,

                    status

                );


                console.log(

                    `[AUDIT] ${username} | ${method} ${route} | ${res.statusCode} | ${duration}ms`

                );

            }
        );


        next();

    }
);


// ============================================================
// JWT AUTH
// ============================================================

function jwtAuth(
    req,
    res,
    next
) {

    try {

        const authHeader =
            req.headers.authorization;


        if (!authHeader) {

            return res.status(401).json({

                status:
                    "error",

                message:
                    "No authorization header"

            });

        }


        const token =
            authHeader.split(" ")[1];


        if (!token) {

            return res.status(401).json({

                status:
                    "error",

                message:
                    "No token provided"

            });

        }


        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );


        req.user =
            decoded;


        console.log(
            `Authenticated: ${decoded.username}`
        );


        next();

    } catch (error) {

        console.error(
            "JWT Error:",
            error.message
        );


        return res.status(401).json({

            status:
                "error",

            message:
                "Invalid or expired token"

        });

    }

}


// ============================================================
// APP A
// ============================================================

app.use(
    "/appA",
    appARouter
);


// ============================================================
// EMAIL
// ============================================================

const transporter =
    nodemailer.createTransport({

        host:
            "cp68.domains.co.za",

        port:
            465,

        secure:
            true,

        auth: {

            user:
                process.env.EMAIL_USER,

            pass:
                process.env.EMAIL_PASS

        }

    });


// ============================================================
// CLIENT FIELDS
// ============================================================

const clientFields = [

    "databaseId",

    "clientRep",

    "secondaryAdvisor",

    "repIdNumber",

    "productProvider",

    "fspType",

    "carrier",

    "product",

    "type",

    "created",

    "clientStatus",

    "client",

    "clientType",

    "idNo",

    "regNo",

    "workTel",

    "homeTel",

    "cell",

    "fax",

    "email",

    "language",

    "clientPhysicalAddress",

    "clientPostalAddress",

    "databasePolicyId",

    "clientSource",

    "policyNo",

    "insurerProductName",

    "policyStatus",

    "policyType",

    "paymentType",

    "paymentMethod",

    "originalInception",

    "inception",

    "amendment",

    "renewal",

    "cancelled"

];


// ============================================================
// CLEAN CLIENT
// ============================================================

function cleanClientData(
    data = {}
) {

    const client = {};


    clientFields.forEach(
        field => {

            if (
                data[field] !==
                    undefined &&
                data[field] !==
                    null
            ) {

                client[field] =
                    data[field];

            } else {

                client[field] =
                    "";

            }

        }
    );


    return client;

}


// ============================================================
// SERVER STATUS
// ============================================================

app.get(
    "/server-status",
    (req, res) => {

        res.send(
            "Hello World!"
        );

    }
);


// ============================================================
// CLIENTS
// ============================================================


// GET ALL CLIENTS

app.get(
    "/clients",
    jwtAuth,
    async (req, res) => {

        try {

            const snapshot =
                await db
                    .collection("clients")
                    .get();


            const clients =
                snapshot.docs.map(
                    doc => ({

                        id:
                            doc.id,

                        ...doc.data()

                    })
                );


            res.json({

                status:
                    "success",

                clients

            });

        } catch (error) {

            console.error(
                "GET CLIENTS ERROR:",
                error
            );


            res.status(500).json({

                status:
                    "error",

                message:
                    "Error fetching clients"

            });

        }

    }
);


// GET ONE CLIENT

app.get(
    "/clients/:id",
    jwtAuth,
    async (req, res) => {

        try {

            const clientDoc =
                await db
                    .collection("clients")
                    .doc(req.params.id)
                    .get();


            if (
                !clientDoc.exists
            ) {

                return res.status(404).json({

                    status:
                        "error",

                    message:
                        "Client not found"

                });

            }


            res.json({

                status:
                    "success",

                client: {

                    id:
                        clientDoc.id,

                    ...clientDoc.data()

                }

            });

        } catch (error) {

            console.error(
                "GET CLIENT ERROR:",
                error
            );


            res.status(500).json({

                status:
                    "error",

                message:
                    "Error fetching client"

            });

        }

    }
);


// CREATE CLIENT / IMPORT CLIENTS

app.post(
    "/clients",
    jwtAuth,
    async (req, res) => {

        try {

            let clientsToCreate;


            if (
                Array.isArray(
                    req.body
                )
            ) {

                clientsToCreate =
                    req.body;

            } else if (
                Array.isArray(
                    req.body.clients
                )
            ) {

                clientsToCreate =
                    req.body.clients;

            } else if (
                req.body.client &&
                typeof req.body.client ===
                    "object"
            ) {

                clientsToCreate = [
                    req.body.client
                ];

            } else {

                clientsToCreate = [
                    req.body
                ];

            }


            if (
                clientsToCreate.length ===
                0
            ) {

                return res.status(400).json({

                    status:
                        "error",

                    message:
                        "No clients supplied"

                });

            }


            const batch =
                db.batch();


            const createdClients =
                [];


            for (
                const rawClient
                of clientsToCreate
            ) {

                const client =
                    cleanClientData(
                        rawClient
                    );


                const clientRef =
                    db
                        .collection("clients")
                        .doc();


                const now =
                    new Date()
                        .toISOString();


                const username =
                    req.user?.username ||
                    "Unknown";


                const clientData = {

                    ...client,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                    createdBy:
                        username,

                    updatedBy:
                        username

                };


                batch.set(
                    clientRef,
                    clientData
                );


                createdClients.push({

                    id:
                        clientRef.id,

                    ...clientData

                });

            }


            await batch.commit();


            res.status(201).json({

                status:
                    "success",

                message:
                    `${createdClients.length} client(s) created successfully`,

                clients:
                    createdClients

            });

        } catch (error) {

            console.error(
                "CREATE CLIENT ERROR:",
                error
            );


            res.status(500).json({

                status:
                    "error",

                message:
                    "Error creating client(s): " +
                    error.message

            });

        }

    }
);


// UPDATE CLIENT

app.patch(
    "/client/:id",
    jwtAuth,
    async (req, res) => {

        try {

            const clientRef =
                db
                    .collection("clients")
                    .doc(req.params.id);


            const existing =
                await clientRef.get();


            if (
                !existing.exists
            ) {

                return res.status(404).json({

                    status:
                        "error",

                    message:
                        "Client not found"

                });

            }


            const changes = {};


            clientFields.forEach(
                field => {

                    if (
                        req.body[field] !==
                        undefined
                    ) {

                        changes[field] =
                            req.body[field];

                    }

                }
            );


            changes.updatedAt =
                new Date()
                    .toISOString();


            changes.updatedBy =
                req.user?.username ||
                "Unknown";


            await clientRef.update(
                changes
            );


            const updated =
                await clientRef.get();


            res.json({

                status:
                    "success",

                message:
                    "Client updated successfully",

                client: {

                    id:
                        updated.id,

                    ...updated.data()

                }

            });

        } catch (error) {

            console.error(
                "UPDATE CLIENT ERROR:",
                error
            );


            res.status(500).json({

                status:
                    "error",

                message:
                    "Error updating client: " +
                    error.message

            });

        }

    }
);


// DELETE CLIENT

app.delete(
    "/client/:id",
    jwtAuth,
    async (req, res) => {

        try {

            const clientRef =
                db
                    .collection("clients")
                    .doc(req.params.id);


            const existing =
                await clientRef.get();


            if (
                !existing.exists
            ) {

                return res.status(404).json({

                    status:
                        "error",

                    message:
                        "Client not found"

                });

            }


            await clientRef.delete();


            res.json({

                status:
                    "success",

                message:
                    "Client deleted successfully"

            });

        } catch (error) {

            console.error(
                "DELETE CLIENT ERROR:",
                error
            );


            res.status(500).json({

                status:
                    "error",

                message:
                    "Error deleting client: " +
                    error.message

            });

        }

    }
);


// ============================================================
// HISTORY
// ============================================================

app.get(
    "/history",
    jwtAuth,
    async (req, res) => {

        try {

            const historySnapshot =
                await db
                    .collection("history")
                    .orderBy(
                        "timestamp",
                        "desc"
                    )
                    .get();


            const history = [];


            historySnapshot.forEach(
                doc => {

                    history.push({

                        id:
                            doc.id,

                        ...doc.data()

                    });

                }
            );


            res.json(
                history
            );

        } catch (error) {

            console.error(
                "GET HISTORY ERROR:",
                error
            );


            res.status(500).json({

                message:
                    "Error fetching history",

                status:
                    "error"

            });

        }

    }
);


// ============================================================
// FILES
// ============================================================

app.get(
    "/api/files",
    jwtAuth,
    async (req, res) => {

        try {

            const path =
                req.query.path ||
                "/root";


            const snapshot =
                await db
                    .collection("nodes")
                    .where(
                        "parentPath",
                        "==",
                        path
                    )
                    .get();


            const results =
                snapshot.docs.map(
                    doc =>
                        doc.data()
                );


            return res.json(
                results
            );

        } catch (err) {

            console.error(err);


            return res.status(500).json({

                error:
                    "Failed to fetch files"

            });

        }

    }
);


app.get(
    "/api/all-files",
    jwtAuth,
    async (req, res) => {

        try {

            const snapshot =
                await db
                    .collection("nodes")
                    .get();


            res.json(

                snapshot.docs.map(
                    doc =>
                        doc.data()
                )

            );

        } catch (error) {

            console.error(error);


            res.status(500).json({

                error:
                    "Failed to fetch files"

            });

        }

    }
);


// ============================================================
// DOCUMENT URL
// ============================================================

app.get(
    "/api/document/:id",
    jwtAuth,
    async (req, res) => {

        try {

            const snapshot =
                await db
                    .collection("nodes")
                    .where(
                        "id",
                        "==",
                        req.params.id
                    )
                    .limit(1)
                    .get();


            if (
                snapshot.empty
            ) {

                return res.status(404).json({

                    error:
                        "Document not found"

                });

            }


            const fileData =
                snapshot.docs[0]
                    .data();


            const storageFile =
                bucket.file(
                    fileData.filePath
                );


            const [
                signedUrl
            ] =
                await storageFile
                    .getSignedUrl({

                        action:
                            "read",

                        expires:
                            Date.now() +
                            3600000

                    });


            res.json({

                url:
                    signedUrl

            });

        } catch (err) {

            console.error(err);


            res.status(500).json({

                error:
                    "Failed to generate URL"

            });

        }

    }
);


// ============================================================
// LOGIN
// ============================================================

app.post(
    "/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;


            console.log(
                `Login attempt: ${username}`
            );


            const userSnapshot =
                await db
                    .collection("users")
                    .where(
                        "username",
                        "==",
                        username
                    )
                    .limit(1)
                    .get();


            if (
                userSnapshot.empty
            ) {

                return res.status(401).json({

                    status:
                        "error",

                    message:
                        "Username not found"

                });

            }


            const userDoc =
                userSnapshot.docs[0];


            const user =
                userDoc.data();


            const match =
                await bcrypt.compare(

                    password +
                    process.env.PEPPER,

                    user.password

                );


            if (!match) {

                return res.status(401).json({

                    status:
                        "error",

                    message:
                        "Invalid credentials"

                });

            }


            console.log(
                `Password verified for ${username}`
            );


            const code =
                Math.floor(
                    100000 +
                    Math.random() *
                    900000
                ).toString();


            console.log(
                "Generated OTP "+code
            );


            await db
                .collection("mfa_codes")
                .doc(userDoc.id)
                .set({

                    code,

                    expiresAt:
                        Date.now() +
                        5 * 60 * 1000,

                    createdAt:
                        Date.now()

                });


            console.log(
                "OTP saved to Firestore"
            );


            await transporter.sendMail({

                from:
                    process.env.EMAIL_USER,

                to:
                    user.email,

                subject:
                    "Futur-e Verification Code",

                html: `

                    <div
                        style="
                            font-family: Arial, sans-serif;
                        "
                    >

                        <h2>
                            Futur-e Login Verification
                        </h2>

                        <p>
                            Your verification code is:
                        </p>

                        <h1>
                            ${code}
                        </h1>

                        <p>
                            This code expires in 5 minutes.
                        </p>

                        <p>
                            If you did not request this login,
                            please ignore this email.
                        </p>

                    </div>

                `

            });


            return res.json({

                status:
                    "mfa_required",

                userId:
                    userDoc.id,

                message:
                    "Verification code sent"

            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );


            return res.status(500).json({

                status:
                    "error",

                message:
                    error.message ||
                    "Internal server error"

            });

        }

    }
);


// ============================================================
// VERIFY TOKEN
// ============================================================

app.post(
    "/verify-token",
    (req, res) => {

        const {
            token
        } = req.body;


        try {

            const decoded =
                jwt.verify(
                    token,
                    process.env.JWT_SECRET
                );


            res.json({

                decoded,

                message:
                    "Token is valid",

                status:
                    "success"

            });

        } catch (err) {

            res.json({

                message:
                    "Invalid token",

                status:
                    "error"

            });

        }

    }
);


// ============================================================
// CREATE USER
// ============================================================

app.post(
    "/create-user",
    jwtAuth,
    async (req, res) => {

        try {

            const {
                username,
                password,
                email,
                admin,
                marketing
            } = req.body;


            const hash =
                await bcrypt.hash(

                    password +
                    process.env.PEPPER,

                    15

                );


            const rights = {

                user:
                    true,

                admin:
                    admin ||
                    false,

                marketing:
                    marketing ||
                    false

            };


            await db
                .collection("users")
                .add({

                    username,

                    password:
                        hash,

                    email,

                    rights

                });


            res.json({

                message:
                    "User created successfully",

                status:
                    "success"

            });

        } catch (error) {

            console.error(
                "CREATE USER ERROR:",
                error
            );


            res.status(500).json({

                message:
                    "Error creating user : " +
                    error.message,

                status:
                    "error"

            });

        }

    }
);


// ============================================================
// ONLYOFFICE SAVE
// ============================================================

app.post(
    "/save-file",
    async (req, res) => {

        try {

            console.log(
                "\n================ SAVE CALLBACK ================"
            );


            console.log(
                "Document Key:",
                req.body.key
            );


            console.log(
                "File Type:",
                req.body.filetype
            );


            if (
                req.body.status !== 2 &&
                req.body.status !== 6
            ) {

                console.log(
                    "Ignoring status:",
                    req.body.status
                );


                return res.json({
                    error: 0
                });

            }


            console.log(
                "Download URL received"
            );


            const fileResponse =
                await axios.get(
                    req.body.url,
                    {
                        responseType:
                            "arraybuffer"
                    }
                );


            const originalBuffer =
                Buffer.from(
                    fileResponse.data
                );


            console.log(
                "Downloaded from OnlyOffice"
            );


            console.log(
                "Byte Length:",
                originalBuffer.length
            );


            const documentId =
                req.body.key.substring(
                    0,
                    36
                );


            console.log(
                "Original Key:",
                req.body.key
            );


            console.log(
                "Document ID:",
                documentId
            );


            const snapshot =
                await db
                    .collection("nodes")
                    .where(
                        "id",
                        "==",
                        documentId
                    )
                    .limit(1)
                    .get();


            if (
                snapshot.empty
            ) {

                throw new Error(
                    `No file found for key ${req.body.key}`
                );

            }


            const fileDoc =
                snapshot.docs[0];


            const fileData =
                fileDoc.data();


            console.log(
                "Firestore Doc Found"
            );


            console.log(
                "Firestore ID:",
                fileData.id
            );


            console.log(
                "Stored Path:",
                fileData.filePath
            );


            const storageFile =
                bucket.file(
                    fileData.filePath
                );


            let contentType =
                "application/octet-stream";


            switch (
                req.body.filetype
            ) {

                case "docx":

                    contentType =
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

                    break;


                case "xlsx":

                    contentType =
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

                    break;


                case "pptx":

                    contentType =
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation";

                    break;


                case "txt":

                    contentType =
                        "text/plain";

                    break;

            }


            await fileDoc.ref.update({

                saveStatus:
                    "saving"

            });


            await storageFile.save(
                originalBuffer,
                {

                    metadata: {

                        contentType

                    }

                }
            );


            console.log(
                "Upload Complete"
            );


            const [
                exists
            ] =
                await storageFile.exists();


            if (!exists) {

                throw new Error(
                    "Upload completed but file does not exist in storage"
                );

            }


            const [
                firebaseBuffer
            ] =
                await storageFile.download();


            const buffersMatch =
                originalBuffer.equals(
                    firebaseBuffer
                );


            if (!buffersMatch) {

                throw new Error(
                    "Firebase file differs from OnlyOffice file"
                );

            }


            const [
                metadata
            ] =
                await storageFile
                    .getMetadata();


            console.log(
                "Storage Metadata:",
                metadata
            );


            if (
                Number(
                    metadata.size
                ) !==
                originalBuffer.length
            ) {

                throw new Error(
                    `Size mismatch. Storage=${metadata.size} Local=${originalBuffer.length}`
                );

            }


            try {

                const [
                    signedUrl
                ] =
                    await storageFile
                        .getSignedUrl({

                            action:
                                "read",

                            expires:
                                Date.now() +
                                60 * 60 * 1000

                        });


                const signedResponse =
                    await axios.get(
                        signedUrl,
                        {
                            responseType:
                                "arraybuffer"
                        }
                    );


                const signedBuffer =
                    Buffer.from(
                        signedResponse.data
                    );


                console.log(
                    "Signed URL Verification:",
                    originalBuffer.equals(
                        signedBuffer
                    )
                );

            } catch (signedErr) {

                console.error(
                    "Signed URL Verification Failed:",
                    signedErr
                );

            }


            const now =
                new Date()
                    .toISOString();


            await fileDoc.ref.update({

                updatedAt:
                    now,

                lastEditedBy:
                    "OnlyOffice",

                saveStatus:
                    "saved"

            });


            console.log(
                "Firestore Updated"
            );


            console.log(
                "==============================================="
            );


            console.log(
                "SAVE VERIFIED SUCCESSFULLY"
            );


            console.log(
                "OnlyOffice -> Firebase -> Download -> Verified"
            );


            console.log(
                "===============================================\n"
            );


            return res.json({
                error: 0
            });


        } catch (err) {

            console.error(
                "\n========== SAVE ERROR =========="
            );


            console.error(err);


            console.error(
                "================================\n"
            );


            return res.json({

                error:
                    1

            });

        }

    }
);


// ============================================================
// SMS
// ============================================================

app.post(
    "/send-sms",
    jwtAuth,
    async (req, res) => {

        try {

            const {
                message,
                numbers
            } = req.body;


            const apiKey =
                process.env.SMSAPIKEY;


            const apiSecret =
                process.env.SMSAPISECRET;


            const credentials =
                apiKey +
                ":" +
                apiSecret;


            const buff =
                Buffer.from(
                    credentials
                );


            const base64Credentials =
                buff.toString(
                    "base64"
                );


            const requestHeaders = {

                headers: {

                    Authorization:
                        `Basic ${base64Credentials}`,

                    "Content-Type":
                        "application/json"

                }

            };


            const requestData = {

                messages:
                    numbers.map(
                        number => ({

                            content:
                                message,

                            destination:
                                number

                        })
                    )

            };


            const response =
                await axios.post(

                    "https://rest.smsportal.com/bulkmessages",

                    requestData,

                    requestHeaders

                );


            return res.json({

                status:
                    "success",

                data:
                    response.data

            });

        } catch (error) {

            console.error(
                "Error sending SMS:",
                error
            );


            return res.status(500).json({

                status:
                    "error",

                message:
                    error.message

            });

        }

    }
);


// ============================================================
// EMAIL
// ============================================================

app.post(
    "/send-email",
    jwtAuth,
    async (req, res) => {

        try {

            const {
                emails,
                subject,
                message
            } = req.body;


            if (
                !emails ||
                emails.length === 0
            ) {

                return res.status(400).json({

                    status:
                        "error",

                    message:
                        "No recipients selected"

                });

            }


            const sendPromises =
                emails.map(
                    email => {

                        return transporter
                            .sendMail({

                                from:
                                    process.env.EMAIL_USER,

                                to:
                                    email,

                                subject,

                                html: `

                                    <div
                                        style="
                                            font-family:Arial;
                                        "
                                    >

                                        ${message.replace(
                                            /\n/g,
                                            "<br/>"
                                        )}

                                    </div>

                                `

                            });

                    }
                );


            await Promise.all(
                sendPromises
            );


            res.json({

                status:
                    "success",

                message:
                    `Emails sent to ${emails.length} recipients`

            });

        } catch (error) {

            console.error(
                error
            );


            res.status(500).json({

                status:
                    "error",

                message:
                    error.message

            });

        }

    }
);


// ============================================================
// VERIFY EMAIL OTP
// ============================================================

app.post(
    "/verify-email-otp",
    async (req, res) => {

        try {

            const {
                userId,
                code
            } = req.body;


            const otpDoc =
                await db
                    .collection("mfa_codes")
                    .doc(userId)
                    .get();


            if (
                !otpDoc.exists
            ) {

                return res.json({

                    status:
                        "error",

                    message:
                        "No OTP found"

                });

            }


            const otpData =
                otpDoc.data();


            if (
                Date.now() >
                otpData.expiresAt
            ) {

                return res.json({

                    status:
                        "error",

                    message:
                        "OTP expired"

                });

            }


            if (
                otpData.code !==
                code
            ) {

                return res.json({

                    status:
                        "error",

                    message:
                        "Invalid OTP"

                });

            }


            const userDoc =
                await db
                    .collection("users")
                    .doc(userId)
                    .get();


            const token =
                jwt.sign(

                    {

                        id:
                            userDoc.id,

                        username:
                            userDoc
                                .data()
                                .username

                    },

                    process.env.JWT_SECRET,

                    {

                        expiresIn:
                            "1h"

                    }

                );


            await db
                .collection("mfa_codes")
                .doc(userId)
                .delete();


            res.json({

                status:
                    "success",

                token

            });

        } catch (err) {

            console.error(
                err
            );


            res.status(500).json({

                status:
                    "error"

            });

        }

    }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);