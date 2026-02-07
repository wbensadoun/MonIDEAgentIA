/* eslint-env jest */
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders app without crashing', () => {
  render(<App />);
  const projectElement = screen.getByText(/Projet/i);
  expect(projectElement).toBeInTheDocument();
});
