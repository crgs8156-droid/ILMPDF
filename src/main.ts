import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('ILMPDF: #app element missing');

export default mount(App, { target });
