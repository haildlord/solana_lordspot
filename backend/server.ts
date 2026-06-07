import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import quoteRouter from './router/quoteRouter';

dotenv.config();

const app = express();
app.use(express.json());

app.use(cors({
   origin: [`http://localhost:5173`, `https://lordspot.vercel.app`], // ! remove localhost in production
   methods: ['GET', 'POST']
}));

app.get(`/health`, (req: Request, res: Response) => {
    res.status(200).json({ message: 'Relayer Engine Online' });
});

app.use(`/api`, quoteRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});
