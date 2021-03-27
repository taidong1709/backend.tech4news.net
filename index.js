import express from "express";
import Sequelize, { Op } from "sequelize";

import * as firebase from "firebase-admin";

(async () => {
    firebase.initializeApp({
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
            primaryKey: true
        },
        title: Sequelize.STRING,
        thumbnail: Sequelize.STRING,
        datePublished: {
            type: Sequelize.DATE,
            defaultValue: Sequelize.NOW
        },
        description: Sequelize.STRING,
        content: Sequelize.STRING,
        viewCount: {
            type: Sequelize.STRING,
            defaultValue: "0"
        },
        catelogyID: Sequelize.INTEGER
    });
    let CommmentModel = sequelize.define("comments", {
        commentID: {
            type: Sequelize.INTEGER,
            primaryKey: true
        },
        user: Sequelize.STRING,
        userID: Sequelize.STRING,
        content: Sequelize.STRING,
        replyTo: {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null
        },
        commentToPost: Sequelize.INTEGER
    });

    app.use(express.query());
    app.use(express.json());
    app.get("/getPost", async (req, res) => {
        if (req.query.postID) {
            let postID = +req.query.postID;
            if (isNaN(postID)) return res.status(400).json({ error: "required query: postID" });

            let post = await ArticleModel.findOne({
                where: {
                    id: postID
                }
            });

            if (post) {
                await post.update({
                    viewCount: (BigInt(post.get("viewCount")) + 1n).toString()
                });
                res.status(200).json({
                    ...post.get()
                });
            } else {
                res.status(404).json({ error: "article not found" });
            }
        } else {
            res.status(400).json({ error: "required query: postID" });
        }
    });

    app.get("/getCatelogyPosts", async (req, res) => {
        if (req.query.catelogyID) {
            let catelogyID = +req.query.catelogyID;
            if (isNaN(catelogyID)) return res.status(400).json({ error: "required query: catelogyID" });

            let posts = await ArticleModel.findAndCountAll({
                where: {
                    catelogyID: catelogyID
                }
            });

            res.status(200).json({
                count: posts.count,
                posts: posts.rows.map(r => r.get())
            });
        } else {
            res.status(400).json({ error: "required query: catelogyID" });
        }
    });

    app.get("/findPosts", async (req, res) => {
        if (req.query.search && req.query.search.length > 1) {
            let posts = await ArticleModel.findAndCountAll({
                where: {
                    title: {
                        [Op.like]: `%${req.query.search}%`
                    }
                }
            });

            res.status(200).json({
                count: posts.count,
                posts: posts.rows.map(r => r.get())
            });
        } else {
            res.status(400).json({ error: "required query: search" });
        }
    });

    app.get("/getComments", async (req, res) => {
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
                    }
                });

                return {
                    count: comments.count,
                    comments: comments.rows.map(r => r.get())
                }
            } else {
                res.status(404).json({ error: "article not found" });
            }
        } else {
            res.status(400).json({ error: "required query: postID" });
        }
    });

    app.post("/addComments", async (req, res) => {
        
    });

    app.listen(process.env.PORT || 3000);
})();