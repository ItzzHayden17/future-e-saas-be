import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcrypt";
import axios from "axios";
import nodemailer from "nodemailer";
import appAapp from "./appA/appA.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ============================================================
// FIREBASE ADMIN
// Analytics belongs in the React frontend, NOT this backend.
// ============================================================

const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    "./futur-e-saas-firebase-adminsdk-fbsvc-3eac3fd621.json";

const serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
);

const mainApp = admin.initializeApp(
    {
        credential: admin.credential.cert(serviceAccount),
        storageBucket:
            process.env.FIREBASE_STORAGE_BUCKET || "futur-e-saas-docs",
    },
    "main"
);

const db = mainApp.firestore();
const bucket = mainApp.storage().bucket();

// ============================================================
// JWT AUTH
// ============================================================

function jwtAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                status: "error",
                message: "No authorization header",
            });
        }

        const [scheme, token] = authHeader.split(" ");

        if (scheme !== "Bearer" || !token) {
            return res.status(401).json({
                status: "error",
                message: "Invalid authorization header",
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not configured.");

            return res.status(500).json({
                status: "error",
                message: "Authentication is not configured",
            });
        }

        req.user = jwt.verify(token, process.env.JWT_SECRET);

        next();
    } catch (error) {
        console.error("JWT Error:", error.message);

        return res.status(401).json({
            status: "error",
            message: "Invalid or expired token",
        });
    }
}

// ============================================================
// HISTORY / AUDIT LOGGER
// ============================================================

function logHistory(route, action, user, status = "success") {
    db.collection("history")
        .add({
            route,
            action,
            user: user || "Unauthenticated",
            status,
            timestamp: new Date(),
        })
        .catch((error) => {
            console.error("History error:", error.message);
        });
}

// Do not log OPTIONS or /history requests to Firestore.
// Otherwise, viewing history itself creates more history entries.

app.use((req, res, next) => {
    if (req.method === "OPTIONS" || req.path === "/history") {
        return next();
    }

    const startTime = Date.now();

    res.on("finish", () => {
        const duration = Date.now() - startTime;
        const username = req.user?.username || "Unauthenticated";
        const status = res.statusCode >= 400 ? "error" : "success";
        const route = req.originalUrl || req.url;
        const action = `${req.method} ${route}`;

        logHistory(route, action, username, status);

        console.log(
            `[AUDIT] ${username} | ${req.method} ${route} | ${res.statusCode} | ${duration}ms`
        );
    });

    next();
});

// ============================================================
// APP A
// ============================================================

app.use("/appA", appAapp);

// ============================================================
// EMAIL TRANSPORTER
// ============================================================

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "cp68.domains.co.za",
    port: Number(process.env.EMAIL_PORT || 465),
    secure: String(process.env.EMAIL_SECURE || "true") === "true",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
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
    "cancelled",
];

function cleanClientData(data = {}) {
    const client = {};

    for (const field of clientFields) {
        client[field] =
            data[field] !== undefined && data[field] !== null
                ? data[field]
                : "";
    }

    return client;
}

// ============================================================
// SERVER STATUS
// ============================================================

app.get("/server-status", (req, res) => {
    res.send("Hello World!");
});

// ============================================================
// CLIENTS
// ============================================================

// GET ALL CLIENTS
app.get("/clients", jwtAuth, async (req, res) => {
    try {
        const snapshot = await db.collection("clients").get();

        const clients = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json({
            status: "success",
            clients,
        });
    } catch (error) {
        console.error("GET CLIENTS ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Error fetching clients",
        });
    }
});

// GET ONE CLIENT
app.get("/clients/:id", jwtAuth, async (req, res) => {
    try {
        const doc = await db.collection("clients").doc(req.params.id).get();

        if (!doc.exists) {
            return res.status(404).json({
                status: "error",
                message: "Client not found",
            });
        }

        return res.json({
            status: "success",
            client: {
                id: doc.id,
                ...doc.data(),
            },
        });
    } catch (error) {
        console.error("GET CLIENT ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Error fetching client",
        });
    }
});

// CREATE CLIENT OR IMPORT CLIENTS
app.post("/clients", jwtAuth, async (req, res) => {
    try {
        let clientsToCreate;

        if (Array.isArray(req.body)) {
            clientsToCreate = req.body;
        } else if (Array.isArray(req.body.clients)) {
            clientsToCreate = req.body.clients;
        } else if (
            req.body.client &&
            typeof req.body.client === "object"
        ) {
            clientsToCreate = [req.body.client];
        } else {
            clientsToCreate = [req.body];
        }

        if (!clientsToCreate.length) {
            return res.status(400).json({
                status: "error",
                message: "No clients supplied",
            });
        }

        if (clientsToCreate.length > 500) {
            return res.status(400).json({
                status: "error",
                message: "Maximum 500 clients per request",
            });
        }

        if (
            clientsToCreate.some(
                (item) =>
                    !item ||
                    typeof item !== "object" ||
                    Array.isArray(item)
            )
        ) {
            return res.status(400).json({
                status: "error",
                message: "Each client must be an object",
            });
        }

        const batch = db.batch();
        const createdClients = [];
        const now = new Date().toISOString();
        const username = req.user?.username || "Unknown";

        for (const rawClient of clientsToCreate) {
            const client = cleanClientData(rawClient);
            const ref = db.collection("clients").doc();

            const clientData = {
                ...client,
                createdAt: now,
                updatedAt: now,
                createdBy: username,
                updatedBy: username,
            };

            batch.set(ref, clientData);

            createdClients.push({
                id: ref.id,
                ...clientData,
            });
        }

        await batch.commit();

        return res.status(201).json({
            status: "success",
            message: `${createdClients.length} client(s) created successfully`,
            clients: createdClients,
        });
    } catch (error) {
        console.error("CREATE CLIENT ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Error creating client(s)",
        });
    }
});

// UPDATE CLIENT
app.patch("/client/:id", jwtAuth, async (req, res) => {
    try {
        const ref = db.collection("clients").doc(req.params.id);
        const existing = await ref.get();

        if (!existing.exists) {
            return res.status(404).json({
                status: "error",
                message: "Client not found",
            });
        }

        const changes = {};

        for (const field of clientFields) {
            if (req.body[field] !== undefined) {
                changes[field] = req.body[field];
            }
        }

        changes.updatedAt = new Date().toISOString();
        changes.updatedBy = req.user?.username || "Unknown";

        await ref.update(changes);

        const updated = await ref.get();

        return res.json({
            status: "success",
            message: "Client updated successfully",
            client: {
                id: updated.id,
                ...updated.data(),
            },
        });
    } catch (error) {
        console.error("UPDATE CLIENT ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Error updating client",
        });
    }
});

// DELETE CLIENT
app.delete("/client/:id", jwtAuth, async (req, res) => {
    try {
        const ref = db.collection("clients").doc(req.params.id);
        const existing = await ref.get();

        if (!existing.exists) {
            return res.status(404).json({
                status: "error",
                message: "Client not found",
            });
        }

        await ref.delete();

        return res.json({
            status: "success",
            message: "Client deleted successfully",
        });
    } catch (error) {
        console.error("DELETE CLIENT ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Error deleting client",
        });
    }
});

// ============================================================
// HISTORY
// ============================================================

app.get("/history", jwtAuth, async (req, res) => {
    try {
        // Bound the result so history does not read the entire collection.
        const snapshot = await db
            .collection("history")
            .orderBy("timestamp", "desc")
            .limit(500)
            .get();

        const history = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json(history);
    } catch (error) {
        console.error("GET HISTORY ERROR:", error.message);

        return res.status(500).json({
            message: "Error fetching history",
            status: "error",
        });
    }
});

// ============================================================
// FILES
// ============================================================

app.get("/api/files", jwtAuth, async (req, res) => {
    try {
        const path = req.query.path || "/root";

        const snapshot = await db
            .collection("nodes")
            .where("parentPath", "==", path)
            .get();

        return res.json(
            snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }))
        );
    } catch (error) {
        console.error("GET FILES ERROR:", error.message);

        return res.status(500).json({
            error: "Failed to fetch files",
        });
    }
});

app.get("/api/all-files", jwtAuth, async (req, res) => {
    try {
        const snapshot = await db.collection("nodes").get();

        return res.json(
            snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }))
        );
    } catch (error) {
        console.error("GET ALL FILES ERROR:", error.message);

        return res.status(500).json({
            error: "Failed to fetch files",
        });
    }
});

// ============================================================
// DOCUMENT URL
// ============================================================

app.get("/api/document/:id", jwtAuth, async (req, res) => {
    try {
        const snapshot = await db
            .collection("nodes")
            .where("id", "==", req.params.id)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({
                error: "Document not found",
            });
        }

        const fileData = snapshot.docs[0].data();

        if (!fileData.filePath) {
            return res.status(404).json({
                error: "Document storage path not found",
            });
        }

        const storageFile = bucket.file(fileData.filePath);
        const [exists] = await storageFile.exists();

        if (!exists) {
            return res.status(404).json({
                error: "Storage object does not exist",
            });
        }

        const [signedUrl] = await storageFile.getSignedUrl({
            action: "read",
            expires: Date.now() + 60 * 60 * 1000,
        });

        return res.json({
            url: signedUrl,
        });
    } catch (error) {
        console.error("DOCUMENT URL ERROR:", error.message);

        return res.status(500).json({
            error: "Failed to generate document URL",
        });
    }
});

// ============================================================
// LOGIN
// ============================================================

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                status: "error",
                message: "Username and password are required",
            });
        }

        const snapshot = await db
            .collection("users")
            .where("username", "==", username)
            .limit(1)
            .get();

        // Use the same message for both cases to avoid revealing usernames.
        if (snapshot.empty) {
            return res.status(401).json({
                status: "error",
                message: "Invalid credentials",
            });
        }

        const userDoc = snapshot.docs[0];
        const user = userDoc.data();

        const match = await bcrypt.compare(
            password + (process.env.PEPPER || ""),
            user.password
        );

        if (!match) {
            return res.status(401).json({
                status: "error",
                message: "Invalid credentials",
            });
        }

        const code = String(crypto.randomInt(100000, 1000000));

        await db.collection("mfa_codes").doc(userDoc.id).set({
            code,
            expiresAt: Date.now() + 5 * 60 * 1000,
            createdAt: Date.now(),
            attempts: 0,
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: "Futur-e Verification Code",
            html: `
                <div style="font-family:Arial,sans-serif;">
                    <h2>Futur-e Login Verification</h2>
                    <p>Your verification code is:</p>
                    <h1>${code}</h1>
                    <p>This code expires in 5 minutes.</p>
                    <p>If you did not request this login, please ignore this email.</p>
                </div>
            `,
        });

        return res.json({
            status: "mfa_required",
            userId: userDoc.id,
            message: "Verification code sent",
        });
    } catch (error) {
        console.error("LOGIN ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Internal server error",
        });
    }
});

// ============================================================
// VERIFY TOKEN
// jwtAuth already validates the Authorization Bearer token.
// ============================================================

app.post("/verify-token", jwtAuth, (req, res) => {
    return res.json({
        decoded: req.user,
        message: "Token is valid",
        status: "success",
    });
});

// ============================================================
// CREATE USER
// ============================================================

app.post("/create-user", jwtAuth, requireAdmin, async (req, res) => {
    try {
        const {
            username,
            password,
            email,
            admin: isAdmin,
            marketing,
        } = req.body;

        if (!username || !password || !email) {
            return res.status(400).json({
                status: "error",
                message: "Username, password, and email are required",
            });
        }

        const existing = await db
            .collection("users")
            .where("username", "==", username)
            .limit(1)
            .get();

        if (!existing.empty) {
            return res.status(409).json({
                status: "error",
                message: "Username already exists",
            });
        }

        const hash = await bcrypt.hash(
            password + (process.env.PEPPER || ""),
            15
        );

        await db.collection("users").add({
            username,
            password: hash,
            email,
            rights: {
                user: true,
                admin: Boolean(isAdmin),
                marketing: Boolean(marketing),
            },
        });

        return res.status(201).json({
            message: "User created successfully",
            status: "success",
        });
    } catch (error) {
        console.error("CREATE USER ERROR:", error.message);

        return res.status(500).json({
            message: "Error creating user",
            status: "error",
        });
    }
});

// ============================================================
// ONLYOFFICE SAVE CALLBACK
// NOTE: OnlyOffice calls this endpoint. Configure and validate
// OnlyOffice callback JWTs before exposing this publicly.
// ============================================================

app.post("/save-file", async (req, res) => {
    try {
        if (req.body.status !== 2 && req.body.status !== 6) {
            return res.json({ error: 0 });
        }

        if (!req.body.url || !req.body.key || !req.body.filetype) {
            return res.status(400).json({ error: 1 });
        }

        const fileResponse = await axios.get(req.body.url, {
            responseType: "arraybuffer",
            timeout: 30000,
        });

        const originalBuffer = Buffer.from(fileResponse.data);
        const documentId = String(req.body.key).substring(0, 36);

        const snapshot = await db
            .collection("nodes")
            .where("id", "==", documentId)
            .limit(1)
            .get();

        if (snapshot.empty) {
            throw new Error(`No file found for key ${req.body.key}`);
        }

        const fileDoc = snapshot.docs[0];
        const fileData = fileDoc.data();

        if (!fileData.filePath) {
            throw new Error("File record has no storage path");
        }

        const contentTypes = {
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            txt: "text/plain",
            pdf: "application/pdf",
        };

        const storageFile = bucket.file(fileData.filePath);
        const contentType =
            contentTypes[req.body.filetype] || "application/octet-stream";

        await fileDoc.ref.update({ saveStatus: "saving" });

        await storageFile.save(originalBuffer, {
            resumable: false,
            metadata: { contentType },
        });

        await fileDoc.ref.update({
            updatedAt: new Date().toISOString(),
            lastEditedBy: "OnlyOffice",
            saveStatus: "saved",
        });

        return res.json({ error: 0 });
    } catch (error) {
        console.error("ONLYOFFICE SAVE ERROR:", error.message);

        return res.status(500).json({ error: 1 });
    }
});

// ============================================================
// SMS
// ============================================================

app.post("/send-sms", jwtAuth, async (req, res) => {
    try {
        const { message, numbers } = req.body;

        if (
            typeof message !== "string" ||
            !Array.isArray(numbers) ||
            numbers.length === 0
        ) {
            return res.status(400).json({
                status: "error",
                message: "Message and destination numbers are required",
            });
        }

        if (!process.env.SMSAPIKEY || !process.env.SMSAPISECRET) {
            return res.status(500).json({
                status: "error",
                message: "SMS provider is not configured",
            });
        }

        const credentials = Buffer.from(
            `${process.env.SMSAPIKEY}:${process.env.SMSAPISECRET}`
        ).toString("base64");

        const response = await axios.post(
            "https://rest.smsportal.com/bulkmessages",
            {
                messages: numbers.map((number) => ({
                    content: message,
                    destination: number,
                })),
            },
            {
                headers: {
                    Authorization: `Basic ${credentials}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return res.json({
            status: "success",
            data: response.data,
        });
    } catch (error) {
        console.error(
            "SEND SMS ERROR:",
            error.response?.data || error.message
        );

        return res.status(500).json({
            status: "error",
            message: "Error sending SMS",
        });
    }
});

// ============================================================
// EMAIL
// ============================================================

app.post("/send-email", jwtAuth, async (req, res) => {
    try {
        const { emails, subject, message } = req.body;

        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({
                status: "error",
                message: "No recipients selected",
            });
        }

        if (typeof subject !== "string" || typeof message !== "string") {
            return res.status(400).json({
                status: "error",
                message: "Subject and message are required",
            });
        }

        // Escape message HTML to prevent injected markup.
        const safeMessage = message
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/\n/g, "<br/>");

        await Promise.all(
            emails.map((email) =>
                transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject,
                    html: `
                        <div style="font-family:Arial,sans-serif;">
                            ${safeMessage}
                        </div>
                    `,
                })
            )
        );

        return res.json({
            status: "success",
            message: `Emails sent to ${emails.length} recipients`,
        });
    } catch (error) {
        console.error("SEND EMAIL ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Error sending email",
        });
    }
});

// ============================================================
// VERIFY EMAIL OTP
// ============================================================

app.post("/verify-email-otp", async (req, res) => {
    try {
        const { userId, code } = req.body;

        if (!userId || !code) {
            return res.status(400).json({
                status: "error",
                message: "User ID and verification code are required",
            });
        }

        const otpRef = db.collection("mfa_codes").doc(userId);
        const otpDoc = await otpRef.get();

        if (!otpDoc.exists) {
            return res.status(400).json({
                status: "error",
                message: "Invalid or expired verification code",
            });
        }

        const otpData = otpDoc.data();

        if (Date.now() > otpData.expiresAt || Number(otpData.attempts || 0) >= 5) {
            await otpRef.delete();
            return res.status(400).json({
                status: "error",
                message: "Invalid or expired verification code",
            });
        }

        if (String(otpData.code) !== String(code)) {
            await otpRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
            return res.status(400).json({
                status: "error",
                message: "Invalid or expired verification code",
            });
        }

        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            await otpRef.delete();

            return res.status(400).json({
                status: "error",
                message: "Invalid or expired verification code",
            });
        }

        const user = userDoc.data();

        const token = jwt.sign(
            {
                id: userDoc.id,
                username: user.username,
            },
            process.env.JWT_SECRET,
            { expiresIn: "12h" }
        );

        await otpRef.delete();

        return res.json({
            status: "success",
            token,
        });
    } catch (error) {
        console.error("VERIFY OTP ERROR:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Could not verify code",
        });
    }
});

// ============================================================
// CLAIMS
// ============================================================

const claimsCollection = db.collection("claims");

const CLAIM_FIELDS = [
    "claimNumber", "clientName", "claimDate", "claimType", "claimStatus",
    "claimCategory", "thirdParty", "recoveryProvider", "progress",
    "documentFolderId", "documentFolderPath", "finalisationDate",
    "finalisationReason", "assessorName", "assessorPhone", "assessorEmail",
    "assessorAppointmentDate", "notificationReceived", "typeOfClaim",
    "documentsReceived", "documentsDetailsOutstanding", "claimToInsurer",
    "claimRegistered", "assessorAppointed", "reportReceivedFromAssessor",
    "authorizationReceived", "aolReceivedReplacement",
    "panelbeaterFollowedUp", "iolFollowedUp", "paymentReceived",
    "claimFinalised", "milestoneDates", "documentChecklist", "followUps",
    "notes", "history", "createdAt", "updatedAt", "createdBy", "updatedBy",
];

function sanitizeClaim(data = {}) {
    const claim = {};
    for (const [field, value] of Object.entries(data)) {
        if (field === "id" || field === "password") continue;
        if (value === undefined) continue;
        claim[field] = value;
    }
    for (const field of CLAIM_FIELDS) {
        if (claim[field] === undefined) {
            claim[field] = ["milestoneDates", "documentChecklist", "followUps", "notes", "history"].includes(field) ? [] : "";
        }
    }
    return claim;
}

function claimHistoryEntry(action, details, user) {
    return {
        action,
        details,
        user: user || "Unknown",
        timestamp: new Date().toISOString(),
    };
}



// GET ALL CLAIMS
app.get("/claims", jwtAuth, async (req, res) => {
    try {
        // Limit the read to 500 claims. Increase/remove this only if needed.
        const snapshot = await claimsCollection
            .orderBy("createdAt", "desc")
            .limit(500)
            .get();

        const claims = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.status(200).json({ claims });
    } catch (error) {
        console.error("GET /claims ERROR:", error.message);

        return res.status(500).json({
            message: "Failed to retrieve claims",
        });
    }
});

// GET ONE CLAIM
app.get("/claims/:id", jwtAuth, async (req, res) => {
    try {
        const doc = await claimsCollection.doc(req.params.id).get();

        if (!doc.exists) {
            return res.status(404).json({
                message: "Claim not found",
            });
        }

        return res.status(200).json({
            claim: {
                id: doc.id,
                ...doc.data(),
            },
        });
    } catch (error) {
        console.error("GET /claims/:id ERROR:", error.message);

        return res.status(500).json({
            message: "Failed to retrieve claim",
        });
    }
});

// CREATE ONE CLAIM OR BULK IMPORT
app.post("/claims", jwtAuth, async (req, res) => {
    try {
        const isBulk = Array.isArray(req.body);
        const input = isBulk ? req.body : [req.body];

        if (input.length === 0) {
            return res.status(400).json({
                message: "At least one claim is required",
            });
        }

        if (input.length > 500) {
            return res.status(400).json({
                message: "Maximum 500 claims per request",
            });
        }

        if (
            input.some(
                (item) =>
                    !item ||
                    typeof item !== "object" ||
                    Array.isArray(item)
            )
        ) {
            return res.status(400).json({
                message: "Each claim must be an object",
            });
        }

        const now = new Date().toISOString();
        const batch = db.batch();
        const createdClaims = [];

        for (const item of input) {
            const ref = claimsCollection.doc();

            const claim = {
                ...sanitizeClaim(item),
                createdAt: now,
                updatedAt: now,
                createdBy: req.user?.username || "Unknown",
            };
            claim.history = [
                ...(Array.isArray(claim.history) ? claim.history : []),
                claimHistoryEntry("Claim created", "Initial claim record created", req.user?.username),
            ];

            batch.set(ref, claim);

            createdClaims.push({
                id: ref.id,
                ...claim,
            });
        }

        await batch.commit();

        return res.status(201).json({
            message: isBulk
                ? "Claims created successfully"
                : "Claim created successfully",
            claims: createdClaims,
            ...(isBulk ? {} : { claim: createdClaims[0] }),
        });
    } catch (error) {
        console.error("POST /claims ERROR:", error.message);

        return res.status(500).json({
            message: "Failed to create claim(s)",
        });
    }
});

// UPDATE CLAIM
app.patch("/claims/:id", jwtAuth, async (req, res) => {
    try {
        if (
            !req.body ||
            typeof req.body !== "object" ||
            Array.isArray(req.body)
        ) {
            return res.status(400).json({
                message: "Request body must be an object",
            });
        }

        const ref = claimsCollection.doc(req.params.id);
        const doc = await ref.get();

        if (!doc.exists) {
            return res.status(404).json({
                message: "Claim not found",
            });
        }

        const existingClaim = doc.data();
        const now = new Date().toISOString();
        const incoming = { ...req.body };
        delete incoming.id;
        const history = Array.isArray(existingClaim.history) ? [...existingClaim.history] : [];
        const notes = Array.isArray(existingClaim.notes) ? [...existingClaim.notes] : [];
        const followUps = Array.isArray(existingClaim.followUps) ? [...existingClaim.followUps] : [];
        const documentChecklist = Array.isArray(existingClaim.documentChecklist) ? [...existingClaim.documentChecklist] : [];
        const milestoneDates = Array.isArray(existingClaim.milestoneDates) ? [...existingClaim.milestoneDates] : [];

        if (Array.isArray(incoming.notes)) notes.push(...incoming.notes);
        if (Array.isArray(incoming.followUps)) followUps.push(...incoming.followUps);
        if (Array.isArray(incoming.documentChecklist)) documentChecklist.push(...incoming.documentChecklist);
        if (Array.isArray(incoming.milestoneDates)) milestoneDates.push(...incoming.milestoneDates);

        delete incoming.notes;
        delete incoming.followUps;
        delete incoming.documentChecklist;
        delete incoming.milestoneDates;
        delete incoming.history;

        const changed = Object.keys(incoming).filter((key) =>
            JSON.stringify(existingClaim[key]) !== JSON.stringify(incoming[key])
        );
        if (changed.length) {
            history.push(claimHistoryEntry(
                "Claim updated",
                changed.map((key) => `${key}: ${String(incoming[key] ?? "")}`).join("; "),
                req.user?.username
            ));
        }

        const updatedClaim = {
            ...existingClaim,
            ...incoming,
            notes,
            followUps,
            documentChecklist,
            milestoneDates,
            history,
            updatedAt: now,
            updatedBy: req.user?.username || "Unknown",
        };

        if (incoming.claimFinalised && !existingClaim.claimFinalised) {
            updatedClaim.finalisationDate = incoming.finalisationDate || now.slice(0, 10);
            history.push(claimHistoryEntry("Claim finalised", updatedClaim.finalisationReason || "No reason supplied", req.user?.username));
        }

await ref.update(updatedClaim);

return res.status(200).json({
    message: "Claim updated successfully",
    claim: {
        id: ref.id,
        ...updatedClaim,
    },
});
    } catch (error) {
        console.error("PATCH /claims/:id ERROR:", error.message);

        return res.status(500).json({
            message: "Failed to update claim",
        });
    }
});

// DELETE CLAIM
app.delete("/claims/:id", jwtAuth, async (req, res) => {
    try {
        const ref = claimsCollection.doc(req.params.id);
        const doc = await ref.get();

        if (!doc.exists) {
            return res.status(404).json({
                message: "Claim not found",
            });
        }

        await ref.delete();

        return res.status(200).json({
            message: "Claim deleted successfully",
            id: req.params.id,
        });
    } catch (error) {
        console.error("DELETE /claims/:id ERROR:", error.message);

        return res.status(500).json({
            message: "Failed to delete claim",
        });
    }
});


// ============================================================
// FILE DIRECTORY: CREATE FOLDERS AND UPLOAD FILES
// ============================================================

app.post("/api/folders", jwtAuth, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const parentPath = String(req.body.parentPath || "/root");
        if (!name || /[\\/]/.test(name)) {
            return res.status(400).json({ error: "A valid folder name is required" });
        }
        const path = `${parentPath.replace(/\/$/, "")}/${name}`;
        const existing = await db.collection("nodes").where("path", "==", path).limit(1).get();
        if (!existing.empty) return res.status(409).json({ error: "Folder already exists" });
        const ref = db.collection("nodes").doc();
        const folder = {
            id: ref.id, name, type: "folder", path, parentPath,
            createdAt: new Date().toISOString(),
            lastEditedBy: req.user?.username || "Unknown",
        };
        await ref.set(folder);
        return res.status(201).json(folder);
    } catch (error) {
        console.error("CREATE FOLDER ERROR:", error.message);
        return res.status(500).json({ error: "Failed to create folder" });
    }
});

app.post("/api/upload", jwtAuth, async (req, res) => {
    try {
        const { name, parentPath = "/root", data, contentType } = req.body;
        if (!name || !data) return res.status(400).json({ error: "File name and file data are required" });
        const safeName = String(name).replace(/[\\/]/g, "-");
        const id = db.collection("nodes").doc().id;
        const storagePath = `uploads/${id}/${safeName}`;
        const buffer = Buffer.from(String(data).replace(/^data:.*?;base64,/, ""), "base64");
        const file = bucket.file(storagePath);
        await file.save(buffer, {
            resumable: false,
            metadata: { contentType: contentType || "application/octet-stream" },
        });
        const ext = safeName.includes(".") ? safeName.split(".").pop().toLowerCase() : "";
        const ref = db.collection("nodes").doc();
        const record = {
            id: ref.id, name: safeName, type: "file", ext,
            path: `${String(parentPath).replace(/\/$/, "")}/${safeName}`,
            parentPath, filePath: storagePath,
            size: buffer.length, createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastEditedBy: req.user?.username || "Unknown",
        };
        await ref.set(record);
        return res.status(201).json(record);
    } catch (error) {
        console.error("UPLOAD FILE ERROR:", error.message);
        return res.status(500).json({ error: "Failed to upload file" });
    }
});

// ============================================================
// USER ADMINISTRATION
// ============================================================

async function requireAdmin(req, res, next) {
    try {
        const userDoc = await db.collection("users").doc(req.user.id).get();
        if (!userDoc.exists || !userDoc.data()?.rights?.admin) {
            return res.status(403).json({ status: "error", message: "Administrator access required" });
        }
        next();
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Could not verify administrator access" });
    }
}

app.get("/users", jwtAuth, requireAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection("users").get();
        return res.json({
            users: snapshot.docs.map((doc) => {
                const data = doc.data();
                return { id: doc.id, username: data.username, email: data.email, rights: data.rights || {} };
            }),
        });
    } catch (error) {
        console.error("GET USERS ERROR:", error.message);
        return res.status(500).json({ message: "Failed to retrieve users" });
    }
});

app.patch("/users/:id", jwtAuth, requireAdmin, async (req, res) => {
    try {
        const ref = db.collection("users").doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ message: "User not found" });
        const changes = {};
        if (typeof req.body.email === "string") changes.email = req.body.email.trim();
        if (req.body.rights && typeof req.body.rights === "object") changes.rights = req.body.rights;
        if (typeof req.body.password === "string" && req.body.password.length) {
            changes.password = await bcrypt.hash(req.body.password + (process.env.PEPPER || ""), 15);
        }
        await ref.update(changes);
        return res.json({ status: "success", message: "User updated successfully" });
    } catch (error) {
        console.error("UPDATE USER ERROR:", error.message);
        return res.status(500).json({ message: "Failed to update user" });
    }
});

// ============================================================
// MICROSOFT ONEDRIVE BACKUP
// Requires Microsoft Graph application credentials and a drive ID.
// ============================================================

async function createOneDriveBackup() {
    const { MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, ONEDRIVE_DRIVE_ID } = process.env;
    if (!MICROSOFT_TENANT_ID || !MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !ONEDRIVE_DRIVE_ID) {
        console.warn("OneDrive backup skipped: Microsoft Graph environment variables are not configured.");
        return;
    }

    const tokenResponse = await axios.post(
        `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
        new URLSearchParams({
            client_id: MICROSOFT_CLIENT_ID,
            client_secret: MICROSOFT_CLIENT_SECRET,
            scope: "https://graph.microsoft.com/.default",
            grant_type: "client_credentials",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const token = tokenResponse.data.access_token;
    const collectionNames = ["clients", "claims", "users", "nodes", "history"];
    const backup = {
        createdAt: new Date().toISOString(),
        collections: {},
    };

    for (const collectionName of collectionNames) {
        const snapshot = await db.collection(collectionName).get();
        backup.collections[collectionName] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
    }

    const filename = `futur-e-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${ONEDRIVE_DRIVE_ID}/root:/${filename}:/content`;
    await axios.put(uploadUrl, JSON.stringify(backup), {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        maxBodyLength: Infinity,
    });
    console.log(`OneDrive Firestore backup uploaded: ${filename}`);
}

app.post("/admin/backup/onedrive", jwtAuth, requireAdmin, async (req, res) => {
    try {
        if (!process.env.MICROSOFT_TENANT_ID || !process.env.MICROSOFT_CLIENT_ID ||
            !process.env.MICROSOFT_CLIENT_SECRET || !process.env.ONEDRIVE_DRIVE_ID) {
            return res.status(503).json({ status: "error", message: "Microsoft Graph / OneDrive credentials are not configured" });
        }
        await createOneDriveBackup();
        return res.json({ status: "success", message: "OneDrive backup completed if Microsoft Graph is configured." });
    } catch (error) {
        console.error("ONEDRIVE BACKUP ERROR:", error.response?.data || error.message);
        return res.status(500).json({ status: "error", message: "OneDrive backup failed" });
    }
});

// Run a daily Firestore data backup when OneDrive credentials are configured.
setInterval(() => {
    createOneDriveBackup().catch((error) =>
        console.error("SCHEDULED ONEDRIVE BACKUP ERROR:", error.response?.data || error.message)
    );
}, 24 * 60 * 60 * 1000);

setTimeout(() => {
    createOneDriveBackup().catch((error) =>
        console.error("INITIAL ONEDRIVE BACKUP ERROR:", error.response?.data || error.message)
    );
}, 2 * 60 * 1000);

// ============================================================
// OVERDUE CLAIMS EMAIL REPORT
// Configure OVERDUE_CLAIM_EMAILS as comma-separated addresses.
// ============================================================

async function sendOverdueClaimsReport() {
    const recipients = String(process.env.OVERDUE_CLAIM_EMAILS || "")
        .split(",").map((email) => email.trim()).filter(Boolean);
    if (!recipients.length) return;
    try {
        const snapshot = await claimsCollection.get();
        const now = Date.now();
        const overdue = snapshot.docs.filter((doc) => {
            const claim = doc.data();
            if (claim.claimFinalised || claim.overdueNotificationSentAt) return false;
            const registeredValue = claim.claimRegistered || "";
            const registeredTimestamp = new Date(registeredValue).getTime();
            const timestamp = Number.isFinite(registeredTimestamp)
                ? registeredTimestamp
                : new Date(claim.createdAt).getTime();
            return Number.isFinite(timestamp) && now - timestamp >= 7 * 24 * 60 * 60 * 1000;
        });
        if (!overdue.length) return;
        const rows = overdue.map((doc) => {
            const c = doc.data();
            return `<li>${String(c.claimNumber || doc.id)} — ${String(c.clientName || "Unknown client")} (registered ${String(c.claimRegistered || c.createdAt || "")})</li>`;
        }).join("");
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: recipients.join(","),
            subject: `Futur-e: ${overdue.length} claim(s) open for 7 days`,
            html: `<p>The following claims have remained open for at least seven days:</p><ul>${rows}</ul>`,
        });
        const batch = db.batch();
        overdue.forEach((doc) => batch.update(doc.ref, { overdueNotificationSentAt: new Date().toISOString() }));
        await batch.commit();
    } catch (error) {
        console.error("OVERDUE CLAIM REPORT ERROR:", error.message);
    }
}

// Check daily while the backend process is running.
setInterval(sendOverdueClaimsReport, 24 * 60 * 60 * 1000);
setTimeout(sendOverdueClaimsReport, 60 * 1000);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((error, req, res, next) => {
    console.error("EXPRESS ERROR:", error.message || error);

    if (res.headersSent) {
        return next(error);
    }

    return res.status(500).json({
        status: "error",
        message: "Internal server error",
    });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});