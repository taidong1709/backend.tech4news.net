import fs from "fs";
import crypto from "crypto";

const ADMIN_PUBLIC_KEY = fs.readFileSync("./admin-public.pem", { encoding: "utf8" });

import express from "express";
import Sequelize from "sequelize";
let Op = Sequelize.Op;

import firebase from "firebase-admin";
import cors from "cors";

(async () => {
    let fadmin = firebase.initializeApp({
        credential: firebase.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN))
    });

    let app = express();

    let sequelize = new Sequelize.Sequelize(process.env.DATABASE_URL, {
        dialectOptions: {
            "ssl": {
                "rejectUnauthorized": false
            }
        }
    });

    let ArticleModel = sequelize.define("article", {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        title: Sequelize.TEXT,
        thumbnail: Sequelize.TEXT,
        datePublished: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
        description: Sequelize.TEXT,
        content: Sequelize.TEXT,
        viewCount: {
            type: Sequelize.TEXT,
            defaultValue: "0"
        },
        catelogyID: Sequelize.INTEGER
    });
    ArticleModel.sync();

    let CommmentModel = sequelize.define("comments", {
        commentID: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        userID: Sequelize.TEXT,
        content: Sequelize.TEXT,
        commentToPost: Sequelize.INTEGER,
        timestamp: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        }
    });
    CommmentModel.sync()

    app.use(cors());
    app.use(express.query());
    app.use(express.json());
    app.get("/getpost", async (req, res) => {
        if (req.query.postID) {
            let postID = +req.query.postID;
            if (isNaN(postID)) return res.status(400).json({ error: "required query: postID" });

            let post = await ArticleModel.findOne({
                where: {
                    id: postID
                },
                attributes: ["id", "title", "thumbnail", "datePublished", "description", "viewCount", "catelogyID", "content"]
            });

            if (post) {
                await post.update({
                    viewCount: (BigInt(post.get("viewCount")) + 1n).toString()
                });
                let content = post.get("content");
                try {
                    content = Buffer.from(content, "base64").toString("utf-8");
                } catch {}

                res.status(200).json({
                    ...post.get(),
                    content,
                    datePublished: post.get("datePublished").getTime()
                });
            } else {
                res.status(404).json({ error: "article not found" });
            }
        } else {
            res.status(400).json({ error: "required query: postID" });
        }
    });

    app.get("/getcatelogyposts", async (req, res) => {
        if (req.query.catelogyID) {
            let catelogyID = +req.query.catelogyID;
            if (isNaN(catelogyID)) return res.status(400).json({ error: "required query: catelogyID" });

            let posts = await ArticleModel.findAndCountAll({
                where: catelogyID < 0 ? {} : {
                    catelogyID: catelogyID
                },
                order: [["datePublished", "DESC"]],
                attributes: ["id", "title", "thumbnail", "datePublished", "description", "viewCount"],
                ...((!isNaN(+req.query.limit) && +req.query.limit > 0) ? { limit: +req.query.limit } : {})
            });

            res.status(200).json({
                count: posts.count,
                posts: posts.rows.map(r => ({
                    ...r.get(),
                    datePublished: r.get("datePublished").getTime()
                }))
            });
        } else {
            res.status(400).json({ error: "required query: catelogyID" });
        }
    });

    app.get("/findposts", async (req, res) => {
        if (req.query.search && req.query.search.length > 2) {
            let posts = await ArticleModel.findAndCountAll({
                where: {
                    title: {
                        [Op.like]: `%${req.query.search}%`
                    }
                }
            });

            res.status(200).json({
                count: posts.count,
                order: [["datePublished", "DESC"]],
                posts: posts.rows.map(r => ({
                    ...r.get(),
                    datePublished: r.get("datePublished").getTime()
                }))
            });
        } else {
            res.status(400).json({ error: "required query: search" });
        }
    });

    app.get("/getcomments", async (req, res) => {
        if (req.query.postID) {
            let postID = +req.query.postID;
            if (isNaN(postID)) return res.status(400).json({ error: "required query: postID" });

            let post = await ArticleModel.findOne({
                where: {
                    id: postID
                }
            });

            if (post) {
                let comments = await CommmentModel.findAndCountAll({
                    where: {
                        commentToPost: postID
                    },
                    order: [["timestamp", "DESC"]],
                });

                return res.status(200).json({
                    count: comments.count,
                    comments: await Promise.all(comments.rows.map(r => r.get()).map(async c => {
                        let user = await firebase.auth().getUser(c.userID);
                        return {
                            ...c,
                            timestamp: c.timestamp.getTime(),
                            user: user.displayName ?? "V?? danh"
                        }
                    }))
                });
            } else {
                res.status(404).json({ error: "article not found" });
            }
        } else {
            res.status(400).json({ error: "required query: postID" });
        }
    });

    app.post("/addcomment", async (req, res) => {
        if (req.body && typeof req.body.token === "string" && req.body.token) {
            try {
                let dtoken = await fadmin.auth().verifyIdToken(req.body.token);

                if (typeof req.body.content === "string" && req.body.content) {
                    if (req.body.postID && !isNaN(+req.body.postID)) {
                        if (await ArticleModel.findOne({ where: { id: +req.body.postID } })) {
                            let c = await CommmentModel.create({
                                userID: dtoken.uid,
                                content: req.body.content,
                                commentToPost: +req.body.postID
                            });

                            return res.status(200).json({ ok: true, commentID: c.get("commentID") });
                        } else return res.status(404).json({ error: "article not found" });
                    } else return res.status(400).json({ error: "need context (postID)" });
                } else return res.status(400).json({ error: "need content" });
            } catch (e) {
                return res.status(403).json({ error: "please authenticate" });
            }
        } else return res.status(403).json({ error: "please authenticate" });
    });

    app.post("/deletecomment", async (req, res) => {
        if (req.body && typeof req.body.token === "string" && req.body.token) {
            try {
                let dtoken = await fadmin.auth().verifyIdToken(req.body.token);

                if (req.body.commentID && !isNaN(+req.body.commentID)) {
                    let c = await CommmentModel.findOne({ where: { commentID: +req.body.commentID }, attributes: ["id"] });

                    if (c) {
                        if (c.get("userID") === dtoken.uid) {
                            c.destroy();
                            return res.status(200).json({ ok: true });
                        } else return res.status(403).json({ error: "only your comment can be deleted" });
                    } else return res.status(400).json({ error: "comment not found" });
                } else return res.status(400).json({ error: "need commentID" });
            } catch (e) {
                return res.status(403).json({ error: "please authenticate" });
            }
        } else return res.status(403).json({ error: "please authenticate" });
    });

    app.post("/admin", async (req, res) => {
        if (req.body.encrypted) {
            try {
                let d = (crypto.publicDecrypt({
                    key: ADMIN_PUBLIC_KEY,
                    format: "pem",
                    type: "pkcs1",
                    encoding: "utf8"
                }, req.body.encrypted)).toString("utf8");

                let jd = JSON.parse(d);
                if (jd.timestamp - 240000 > Date.now() || jd.timestamp + 240000 < Date.now())
                    return res.status(403).json({ error: "encrypted data is expired" });

                switch (jd.operation) {
                    case "addarticle":
                        if (jd.title && jd.thumbnail && jd.description && jd.content && jd.catelogyID) {
                            let a = await ArticleModel.create({
                                title: jd.title,
                                thumbnail: jd.thumbnail,
                                description: jd.description,
                                content: jd.content,
                                catelogyID: jd.catelogyID
                            });
                            return res.status(200).json({ ok: true, articleID: a.get("id") });
                        } else return res.status(400).json({ error: "not enough parameter" });
                    case "removearticle":
                        if (jd.articleID) {
                            let a = await ArticleModel.findOne({
                                where: {
                                    id: jd.articleID
                                },
                                attributes: ["id"]
                            });

                            if (a) {
                                await a.destroy();
                                return res.status(200).json({ ok: true });
                            } else return res.status(404).json({ error: "article not found" });
                        } else return res.status(400).json({ error: "not enough parameter" });
                    case "removecomment":
                        if (jd.commentID) {
                            let c = await CommmentModel.findOne({
                                where: {
                                    commentID: jd.commentID
                                },
                                attributes: ["commentID"]
                            });

                            if (c) {
                                await c.destroy();
                                return res.status(200).json({ ok: true });
                            } else return res.status(404).json({ error: "comment not found" });
                        } else return res.status(400).json({ error: "not enough paremeter" });
                    default:
                        return res.status(400).json({ error: "unknown operation" });
                }
            } catch {
                return res.status(403).json({ error: "encrypted data is required" });
            }
        } else return res.status(403).json({ error: "encrypted data is required" });
    });

    app.listen(process.env.PORT || 3000);
})();